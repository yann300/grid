const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')
const { getBinaryUpdater } = require('./util')
const ControlledProcess = require('./ControlledProcess')

let rpcId = 1

class Plugin extends EventEmitter {
  constructor(config, source, meta) {
    super()
    const { name, repository, filter, prefix } = config
    if (!name || !repository) {
      throw new Error(
        'plugin is missing required fields "name" or "repository"'
      )
    }
    this._meta = meta
    this._source = source
    this.updater = getBinaryUpdater(repository, name, filter, prefix)
    this.config = config
    this.process = undefined
    if (config.onInputRequested) {
      this.on('log', log => {
        try {
          config.onInputRequested(log, input => {
            this.process.stdin.write(`${input}\n`)
          })
        } catch (error) {
          console.log(
            `error: plugin ${this.name} could not provide input`,
            error
          )
        }
      })
    }
  }
  get cacheDir() {
    return this.updater.cacheDir
  }
  get name() {
    return this.config.name
  }
  get type() {
    return this.config.type
  }
  get order() {
    return this.config.order
  }
  get displayName() {
    return this.config.displayName
  }
  get defaultConfig() {
    return this.config.config.default
  }
  get source() {
    return this._source
  }
  get metadata() {
    return this._meta
  }
  get state() {
    // FIXME ugly
    return this.process ? this.process.state : 'STOPPED'
  }
  get isRunning() {
    return this.process && this.process.isRunning
  }
  getLogs() {
    return this.process ? this.process.logs : []
  }
  get resolveIpc() {
    return this.config.resolveIpc
  }
  registerEventListeners(sourceEmitter, destEmitter) {
    // FIXME memory leaks start here:
    // forward all events from the spawned process
    let eventTypes = [
      'newState',
      'starting',
      'started',
      'connected',
      'disconnected',
      'error',
      'stopped',
      'log',
      'notification'
    ]
    eventTypes.forEach(eventName => {
      sourceEmitter.on(eventName, arg => {
        if (eventName !== 'log') {
          console.log(`forward external process event >> ${eventName}`)
        }
        destEmitter.emit(eventName, arg)
      })
    })
  }
  async getReleases() {
    const releases = await this.updater.getReleases()
    return releases
  }
  download(release, onProgress) {
    return this.updater.download(release, { onProgress })
  }
  async getLocalBinary(release) {
    if (this.binPath) {
      return {
        binaryPath: this.binPath
      }
    }

    const extractBinary = async (pkg, binaryName) => {
      const entries = await this.updater.getEntries(pkg)
      let binaryEntry = undefined
      if (binaryName) {
        binaryEntry = entries.find(e => e.relativePath.endsWith(binaryName))
      } else {
        // try to detect binary
        console.log(
          'no "binaryName" specified - trying to auto-detect executable within package:'
        )
        // const isExecutable = mode => Boolean((mode & 0o0001) || (mode & 0o0010) || (mode & 0o0100))
        if (process.platform === 'win32') {
          binaryEntry = entries.find(e => e.relativePath.endsWith('.exe'))
        } else {
          // no heuristic available: pick first
          binaryEntry = entries[0]
        }
      }

      if (!binaryEntry) {
        throw new Error(
          'binary not found in package: try to specify binaryName'
        )
      } else {
        binaryName = binaryEntry.file.name
        console.log('auto-detected binary:', binaryName)
      }

      const destAbs = path.join(this.cacheDir, binaryName)
      // The unlinking might fail if the binary is e.g. being used by another instance
      if (fs.existsSync(destAbs)) {
        fs.unlinkSync(destAbs)
      }
      // IMPORTANT: if the binary already exists the mode cannot be set
      fs.writeFileSync(destAbs, await binaryEntry.file.readContent(), {
        mode: parseInt('754', 8) // strict mode prohibits octal numbers in some cases
      })

      // cache the binary path
      this.binPath = destAbs

      return this.binPath
    }

    release = release || (await this.updater.getLatestCached())
    if (release) {
      // Binary in extracted form was found in e.g. standard location on the system
      if (release.isBinary) {
        return release.location
      } else {
        // Binary is packaged as .zip or.tar.gz -> extract first
        try {
          const binaryPath = await extractBinary(
            release,
            this.config.binaryName
          )
          return {
            binaryPath,
            packagePath: release.location
          }
        } catch (error) {
          console.log('error during binary extraction', error)
        }
      }
    }
    console.warn('no binary found for', release)
    return undefined
  }

  async start(release, flags, config) {
    // TODO do flag validation here based on proxy metadata

    const { binaryPath, packagePath } = await this.getLocalBinary(release)
    console.log(
      `client ${
        this.name
      } / ${packagePath} about to start - binary: ${binaryPath}`
    )
    try {
      this.process = new ControlledProcess(binaryPath, this.resolveIpc)
      this.registerEventListeners(this.process, this)

      await this.process.start(flags)
    } catch (error) {
      console.log('error start', error)
    }
    return this.process
  }
  async stop() {
    return this.process && this.process.stop()
  }
  // public json rpc
  async rpc(method, params = []) {
    if (!this.process) {
      console.log('error: rpc not available - process not running', this.state)
      return // FIXME error handling
    }
    const payload = {
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params
    }
    try {
      const result = await this.process.send(payload)
      return result
    } catch (error) {
      return error
    }
  }
  write(payload) {
    if (!this.process) {
      return
    }
    this.process.write(payload)
  }
  async execute(command) {
    const { binaryPath } = await this.getLocalBinary()
    if (!binaryPath) {
      console.log(
        'execution error: binary not found. bad package path or missing/ambiguous binaryName'
      )
      return Promise.reject(new Error('execution error: binary not found'))
    }

    return new Promise((resolve, reject) => {
      console.log('execute command:', command)
      const { spawn } = require('child_process')
      const flags = command.split(' ')
      let proc = undefined
      try {
        proc = spawn(binaryPath, flags)
      } catch (error) {
        // console.log('spawn error', error)
        reject(error)
      }
      const { stdout, stderr, stdin } = proc
      proc.on('error', error => {
        console.log('process error', error)
      })
      const procData = []
      const onData = data => {
        const log = data.toString()
        if (log) {
          let parts = log.split(/\r|\n/)
          parts = parts.filter(p => p !== '')
          //this.logs.push(...parts)
          parts.map(l => this.emit('log', l))
          procData.push(...parts)
          console.log('process data:', parts)
        }
      }
      stdout.on('data', onData)
      stderr.on('data', onData)
      proc.on('close', () => {
        resolve(procData)
      })
    })
  }
  async checkForUpdates() {
    let result = await this.updater.checkForUpdates()
    return result
  }
}

class PluginProxy extends EventEmitter {
  constructor(plugin) {
    super()
    this.plugin = plugin
    // FIXME if listeners are not removed properly this can introduce very nasty memory leaks and effects
    this.plugin.registerEventListeners(this.plugin, this)
  }
  get name() {
    return this.plugin.name
  }
  get type() {
    return this.plugin.type
  }
  get order() {
    return this.plugin.order
  }
  get displayName() {
    return this.plugin.displayName
  }
  get state() {
    return this.plugin.state
  }
  get config() {
    return this.plugin.defaultConfig
  }
  get source() {
    return this.plugin.source
  }
  get metadata() {
    return this.plugin.metadata
  }
  get isRunning() {
    return this.plugin.isRunning
  }
  get error() {
    return ''
  }
  getLogs() {
    return this.plugin.getLogs()
  }
  // FIXME doesn't handle corrupted packages well
  getReleases() {
    return this.plugin.getReleases()
  }
  download(release, onProgress = () => {}) {
    return this.plugin.download(release, progress => {
      onProgress(progress)
    })
  }
  getLocalBinary(release) {
    return this.plugin.getLocalBinary(release)
  }
  start(release, config) {
    return this.plugin.start(release, config)
  }
  stop() {
    console.log(`client ${this.name} stopped`)
    return this.plugin.stop()
  }
  rpc(method, params = []) {
    return this.plugin.rpc(method, params)
  }
  write(payload) {
    return this.plugin.write(payload)
  }
  execute(command) {
    return this.plugin.execute(command)
  }
  checkForUpdates() {
    return this.plugin.checkForUpdates()
  }
}

module.exports = {
  Plugin,
  PluginProxy
}
