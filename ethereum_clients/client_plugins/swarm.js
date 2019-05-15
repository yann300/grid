let platform = 'windows'
let dataDir = `${process.env.APPDATA}/Ethereum`

// Platform specific initialization
switch (process.platform) {
  case 'win32': {
    platform = 'windows'
    dataDir = `${process.env.APPDATA}/Ethereum`
    break
  }
  case 'linux': {
    platform = 'linux'
    dataDir = '~/.ethereum'
    break
  }
  case 'darwin': {
    platform = 'darwin'
    dataDir = '~/Library/Ethereum'
    break
  }
  default: {
  }
}

const gethApi = `${dataDir}/geth.ipc`

module.exports = {
  type: 'client',
  order: 1,
  displayName: 'Swarm',
  name: 'swarm',
  repository: 'https://gethstore.blob.core.windows.net',
  modifiers: {
    version: ({ version }) =>
      version
        .split('-')
        .slice(0, -1)
        .join('-')
  },
  filter: {
    name: {
      includes: [platform],
      excludes: ['unstable', 'alltools']
    }
  },
  prefix: `swarm-${platform}`,
  binaryName: process.platform === 'win32' ? 'swarm.exe' : 'swarm',
  resolveIpc: logs => findIpcPathInLogs(logs),
  config: {
    default: {
      ensApi: gethApi
      // dataDir: 'dataDir',
      // api: 'ipc',
      // network: 'main',
      // syncMode: 'light',
      // ipc: 'ipc',
      // cache: '2048'
    },
    flags: {
      // '--datadir': 'path',
      // '--syncmode': ['fast', 'light', 'full'],
      // '--networkid': 'number',
      // '--testnet': '',
      // '--rinkeby': '',
      // '--ws --wsaddr': 'string',
      // '--wsport': 'number'
    }
  },
  settings: {
    bzzAccount: {
      label: 'BZZ Account',
      flag: '--bzzaccount %s'
    },
    ensApi: {
      label: 'ENS API',
      flag: '--ens-api %s'
    }

    // dataDir: {
    //   default: 'dataDir',
    //   label: 'Data Directory',
    //   flag: '--datadir %s',
    //   type: 'path'
    // },
    // api: {
    //   default: 'ipc',
    //   label: 'API',
    //   options: [
    //     { value: 'ipc', label: 'IPC', flag: '' },
    //     { value: 'websockets', label: 'WebSockets', flag: '--ws' },
    //     { value: 'rpc', label: 'RPC HTTP', flag: '--rpc' }
    //   ]
    // },
    // network: {
    //   default: 'main',
    //   options: [
    //     { value: 'main', label: 'Main', flag: '' },
    //     { value: 'ropsten', label: 'Ropsten (testnet)', flag: '--testnet' },
    //     { value: 'rinkeby', label: 'Rinkeby (testnet)', flag: '--rinkeby' }
    //   ]
    // },
    // syncMode: {
    //   default: 'light',
    //   label: 'Sync Mode',
    //   options: ['fast', 'full', 'light'],
    //   flag: '--syncmode %s'
    // },
    // cache: {
    //   default: '2048',
    //   label: 'Cache',
    //   flag: '--cache %s'
    // }
  }
}
