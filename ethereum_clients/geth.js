const fs = require('fs')
const path = require('path')
const { AppManager } = require('@philipplgh/electron-app-manager')
const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const net = require('net')

// Init CONSTANTS
let EXT_LENGTH = 0
let BINARY_NAME = ''
const STATES = {
  STARTING: 0 /* Node about to be started */,
  STARTED: 1 /* Node started */,
  CONNECTED: 2 /* IPC connected - all ready */,
  STOPPING: 3 /* Node about to be stopped */,
  STOPPED: 4 /* Node stopped */,
  ERROR: -1 /* Unexpected error */
}

// Set up cache
const GETH_CACHE = path.join(__dirname, 'geth_bin')
if (!fs.existsSync(GETH_CACHE)) {
  fs.mkdirSync(GETH_CACHE)
}

// Init variables
let urlFilter = ''
let dataDir = ''
let binaryPaths = []
let rpcId = 1

// Platform specific initialization
switch (process.platform) {
  case 'win32': {
    urlFilter = 'win'
    EXT_LENGTH = '.zip'.length
    BINARY_NAME = 'geth.exe'
    dataDir = '%APPDATA%/Ethereum'
    break
  }
  case 'linux': {
    urlFilter = 'linux'
    EXT_LENGTH = '.tar.gz'.length
    BINARY_NAME = 'geth'
    dataDir = '~/.ethereum'
    break
  }
  case 'darwin': {
    urlFilter = 'darwin'
    EXT_LENGTH = '.tar.gz'.length
    BINARY_NAME = 'geth'
    dataDir = '~/Library/Ethereum'
    break
  }
  default: {
  }
}

const gethUpdater = new AppManager({
  repository: 'https://gethstore.blob.core.windows.net',
  modifiers: {
    version: ({ version }) =>
      version
        .split('-')
        .slice(0, -1)
        .join('-')
  },
  filter: ({ fileName }) =>
    !fileName.includes('alltools') &&
    (urlFilter && fileName.includes(urlFilter)),
  auto: false,
  paths: [],
  cacheDir: GETH_CACHE
})

const defaultConfig = {
  name: 'default',
  dataDir,
  host: 'localhost',
  port: 8545,
  network: 'main',
  syncMode: 'light',
  ipc: 'ipc'
}

// https://github.com/ethereum/ethereum-client-binaries
// https://github.com/ethereumjs/geth.js/blob/master/index.js
// https://github.com/ethereum/ethereum-client-binaries/blob/master/src/index.js
// https://github.com/ethereum/mist/blob/develop/modules/ethereumNode.js
class Geth extends EventEmitter {
  constructor() {
    super()
    this.state = STATES.STOPPED
    this.flags = []
    this.logs = []
    this.ipc = null
    this.responsePromises = {}
    this.config = defaultConfig
  }

  get isRunning() {
    return this.state === STATES.STARTED || this.state === STATES.CONNECTED
  }

  getUpdater() {
    return gethUpdater
  }

  getLogs() {
    return this.logs
  }

  async extractPackageBinaries(binaryPackage) {
    // on mac the tar contains as root entry a dir with the same name as the .tar.gz
    const basePackageName = binaryPackage.fileName.slice(0, -EXT_LENGTH)
    const binaryPathPackage = path.join(basePackageName, BINARY_NAME)
    const gethBinary = await gethUpdater.getEntry(
      binaryPackage,
      binaryPathPackage
    )
    const binaryPathDisk = path.join(GETH_CACHE, basePackageName)

    // the unlinking might fail if the binary is e.g. being used by another instance
    if (fs.existsSync(binaryPathDisk)) {
      fs.unlinkSync(binaryPathDisk)
    }

    // IMPORTANT: if the binary already exists the mode cannot be set
    fs.writeFileSync(binaryPathDisk, await gethBinary.getData(), {
      mode: parseInt('754', 8) // strict mode prohibits octal numbers in some cases
    })

    return binaryPathDisk
  }

  async getLocalBinary() {
    const latestCached = await gethUpdater.getLatestCached()
    if (latestCached) {
      // binary in extracted form was found in e.g. standard location on the system
      if (latestCached.isBinary) {
        return latestCached.location
      } else {
        // binary is packaged as .zip or.tar.gz
        return this.extractPackageBinaries(latestCached)
      }
    }
    return null
  }

  async getLocalBinaries() {
    return await gethUpdater.cache.getReleases()
  }

  async getReleases() {
    return await gethUpdater.getReleases()
  }

  async download(release, onProgress) {
    if (!release) {
      release = await gethUpdater.getLatestRemote()
    }
    const _onProgress = (r, p) => onProgress(p)
    gethUpdater.on('update-progress', _onProgress)
    await gethUpdater.download(release)
    gethUpdater.removeListener(_onProgress)
  }

  getUpdaterMenu() {
    return createMenu(updater)
  }

  getGethFlags() {
    const { dataDir, network, host, port, syncMode, ipc } = this.config
    let flags = []

    if (dataDir) {
      flags.push('--datadir', dataDir)
    }

    if (syncMode) {
      const supportedSyncModes = ['fast', 'light', 'full']
      if (!supportedSyncModes.includes(syncMode)) {
        throw new Error('Geth: Unsupported Sync Mode')
      }
      flags.push('--syncmode', syncMode)
    }

    if (network) {
      switch (network) {
        case 'main':
          flags.push('--networkid', 1)
          break
        case 'ropsten':
          flags.push('--testnet')
          break
        case 'rinkeby':
          flags.push('--rinkeby')
          break
        default:
          throw new Error('Geth: Unsupported Network')
      }
    }

    if (ipc) {
      switch (ipc) {
        case 'ws':
          flags.push('--ws', '--wsaddr', host, '--wsport', port)
          // ToDo: set --wsorigins for security
          break
        case 'http':
          throw new Error('Geth: HTTP is deprecated')
        default:
          break
      }
    }

    return flags
  }

  start(binPackagePath) {
    return new Promise(async (resolve, reject) => {
      if (binPackagePath) {
        this.binPath = await this.extractPackageBinaries(binPackagePath)
      }
      if (!this.binPath) {
        throw new Error('No binPath')
      }

      this.state = STATES.STARTING
      console.log('Start Geth: ', this.binPath)

      // Set flags
      const flags = this.getGethFlags()

      // Spawn process
      const proc = spawn(this.binPath, flags)
      const { stdout, stderr } = proc

      proc.on('error', error => {
        this.states = STATES.ERROR
        console.log('Geth Error in Process: ', error)
        reject(error)
      })

      proc.on('close', code => {
        this.states = STATES.STOPPED
        const message = `Geth child process exited with code: ${code}`
        console.log(message)
        reject(message)
      })

      const onStart = () => {
        this.state = STATES.STARTED
        resolve(true)
      }

      const onData = data => {
        const log = data.toString()
        this.logs.push(log)
        console.log(log)
      }

      stderr.once('data', onStart)
      stdout.on('data', onData)
      stderr.on('data', onData)
      this.proc = proc

      // Check for IPC in 3s
      setTimeout(() => {
        this.getIpcPath()
      }, 3000)
    })
  }

  getIpcPath() {
    console.log('Checking for IPC path...')
    let ipcPath
    const logs = this.getLogs()
    for (const log of logs) {
      const found = log.includes('IPC endpoint opened')
      if (found) {
        ipcPath = log.split('=')[1].trim()
        console.log('Found IPC path: ', ipcPath)
      }
    }
    if (ipcPath) {
      this.connectIpc(ipcPath)
    } else {
      // Recheck in 3s
      setTimeout(() => {
        console.log('IPC endpoint not found, rechecking in 3s...')
        this.getIpcPath()
      }, 3000)
    }
  }

  connectIpc(path) {
    this.ipc = net.connect({ path })

    this.ipc.on('connect', error => {
      this.state = STATES.CONNECTED
      console.log('IPC Connected')
    })

    this.ipc.on('end', function() {
      this.state = STATES.STOPPED
      this.ipc = null
      console.log('IPC Connection Ended')
    })

    this.ipc.on('error', error => {
      this.state = STATES.ERROR
      this.ipc = null
      console.error('IPC Connection Error: ', error)
    })

    this.ipc.on('timeout', function() {
      this.state = STATES.ERROR
      this.ipc = null
      console.error('IPC Connection Timeout')
    })

    this.ipc.on('data', this.onIpcData.bind(this))
  }

  onIpcData(data) {
    console.log('IPC data: ', data.toString())
    let result
    try {
      result = JSON.parse(data)
    } catch (error) {
      console.error('Error parsing JSON: ', error)
    }
    if (result) {
      if (this.responsePromises[result.id]) {
        if (!result.error) {
          this.responsePromises[result.id].resolve(result.result)
        } else {
          this.responsePromises[result.id].reject(result)
        }
        delete this.responsePromises[result.id]
      }
    }
  }

  send(payload) {
    if (this.state !== STATES.CONNECTED) {
      throw Error('IPC Not Connected')
    }

    return new Promise((resolve, reject) => {
      const jsonString = JSON.stringify(payload)
      this.ipc.write(jsonString)
      // Add response promise
      this.responsePromises[payload.id] = { resolve, reject }
    })
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.isRunning) {
        resolve()
      }
      this.state = STATES.STOPPING
      this.proc.on('exit', () => {
        this.state = STATES.STOPPED
        resolve()
      })
      this.proc.on('error', error => {
        this.state = STATES.ERROR
        reject(new Error('Geth Error Stopping: ', error))
      })
      this.proc.kill('SIGINT')
    })
  }

  async restart() {
    await this.stop()
    return this.start()
  }

  async checkForUpdates() {
    let result = await updater.checkForUpdates()
    return result
  }

  setConfig(newConfig) {
    this.config = newConfig
  }

  async getConfig() {
    return this.config
  }

  async getStatus() {
    return {
      client: 'geth',
      binPath: this.binPath,
      version: '1.8.20-stable',
      commit: '24d727b6d6e2c0cde222fa12155c4a6db5caaf2e',
      architecture: 'amd64',
      go: 'go1.11.2',
      isRunning: this.isRunning
    }
  }

  async rpc(method, params = []) {
    const payload = {
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params
    }
    try {
      const result = await this.send(payload)
      return result
    } catch (error) {
      return error
    }
  }

  async network() {
    let response = await this.rpc('net_version')
    return response
  }
}

module.exports = Geth
