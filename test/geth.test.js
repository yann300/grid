const { assert } = require('chai')
const path = require('path')
const Geth = require('../ethereum_clients/geth')

const gethBin = path.join(__dirname, 'fixtures', 'geth_bin')
const mockedReleases = {
  darwin: [
    {
      name: 'geth-darwin-amd64-1.8.21-9dc5d1a9',
      fileName: 'geth-darwin-amd64-1.8.21-9dc5d1a9.tar.gz',
      version: '1.8.21',
      tag: '1.8.21-9dc5d1a9',
      commit: undefined,
      size: '9976551',
      channel: undefined,
      location: path.join(gethBin, 'geth-darwin-amd64-1.8.21-9dc5d1a9.tar.gz'),
      error: undefined,
      checksums: { md5: '81544a325e179459454fb58aa73df54b' },
      signature:
        'https://gethstore.blob.core.windows.net/builds/geth-darwin-amd64-1.8.21-9dc5d1a9.tar.gz.asc'
    }
  ],
  linux: [
    {
      name: 'geth-linux-amd64-1.8.21-9dc5d1a9',
      fileName: 'geth-linux-amd64-1.8.21-9dc5d1a9.tar.gz',
      version: '1.8.21',
      tag: '1.8.21-9dc5d1a9',
      commit: undefined,
      size: '14671229',
      channel: undefined,
      location: path.join(gethBin, 'geth-linux-amd64-1.8.21-9dc5d1a9.tar.gz'),
      error: undefined,
      checksums: { md5: '516fc2665d18e7b117333d2ea4959f9c' },
      signature:
        'https://gethstore.blob.core.windows.net/builds/geth-linux-amd64-1.8.21-9dc5d1a9.tar.gz.asc'
    }
  ],
  windows: [
    {
      name: 'geth-windows-amd64-1.8.21-9dc5d1a9',
      fileName: 'geth-windows-amd64-1.8.21-9dc5d1a9.exe',
      version: '1.8.21',
      tag: '1.8.21-9dc5d1a9',
      commit: undefined,
      size: '45131093',
      channel: undefined,
      location: path.join(gethBin, 'geth-windows-amd64-1.8.21-9dc5d1a9.exe'),
      error: undefined,
      checksums: { md5: 'a5cd4ba8f119168bbdc9cd087d3c89f2' },
      signature:
        'https://gethstore.blob.core.windows.net/builds/geth-windows-amd64-1.8.21-9dc5d1a9.exe.asc'
    }
  ]
}

let release
let dataDir

// Platform specific initialization
switch (process.platform) {
  case 'win32': {
    release = mockedReleases.windows[0]
    dataDir = '%APPDATA%/Ethereum'
    break
  }
  case 'linux': {
    release = mockedReleases.linux[0]
    dataDir = '~/.ethereum'
    break
  }
  case 'darwin': {
    release = mockedReleases.darwin[0]
    dataDir = '~/Library/Ethereum'
    break
  }
  default: {
  }
}

let releases
let downloadedRelease

describe('Clients', function() {
  describe('Geth.js', function() {
    describe('extractPackageBinaries()', function() {
      it('returns the correct binary path disk', async function() {
        const geth = new Geth()
        const binaryPathDisk = await geth.extractPackageBinaries(release)
        assert.include(binaryPathDisk, release.name)
      })
    })

    describe('getLocalBinaries()', function() {
      it('finds all local geth binaries', async function() {
        const geth = new Geth()
        const releases = await geth.getLocalBinaries()
        assert.typeOf(releases, 'array')
        assert.isAbove(releases.length, 0)
        assert.include(releases[0].fileName, release.fileName)
      })
    })

    describe('getLocalBinary()', function() {
      it('returns latest cached local binary', async function() {
        const geth = new Geth()
        const binaryPath = await geth.getLocalBinary()
        assert.include(binaryPath, release.name)
      })
    })

    describe('start()', function() {
      it('starts geth', async function() {
        this.timeout(20 * 1000)
        const geth = new Geth()
        const releases = await geth.getLocalBinaries()
        const result = await geth.start(releases[0])
        assert.equal(result.client, 'geth')
        assert.equal(geth.isRunning, true)
        geth.stop()
      })
    })

    describe('stop()', function() {
      it('stops geth', async function() {
        this.timeout(20 * 1000)
        const geth = new Geth()
        const releases = await geth.getLocalBinaries()
        await geth.start(releases[0])
        const result = await geth.stop(geth)
        assert.equal(result, true)
        assert.equal(geth.isRunning, false)
      })
    })

    describe('restart()', function() {
      it('restarts geth', async function() {
        const geth = new Geth()
        const releases = await geth.getLocalBinaries()
        await geth.start(releases[0])
        const result = await geth.restart()
        assert.equal(result.client, 'geth')
        assert.equal(geth.isRunning, true)
        geth.stop()
      })
    })

    describe('getStatus()', function() {
      it('returns the status', async function() {
        const geth = new Geth()
        const status = geth.getStatus()
        assert.equal(status.client, 'geth')
      })
    })

    describe('getConfig', function() {
      it('returns the config', async function() {
        const geth = new Geth()
        const config = geth.getConfig()
        assert.equal(config.network, 'main')
      })
    })

    describe('setConfig', function() {
      it('sets a new config', async function() {
        const geth = new Geth()
        const config = geth.getConfig()
        const newConfig = { ...config, network: 'ropsten' }
        await geth.setConfig(newConfig)
        assert.equal(geth.getConfig(), newConfig)
      })
    })

    describe('getReleases()', function() {
      it('finds hosted geth releases', async function() {
        this.timeout(30 * 1000)
        const geth = new Geth()
        releases = await geth.getReleases()
        assert.typeOf(releases, 'array')
        assert.include(releases[0].fileName, 'geth')
      })
    })
  })
})
