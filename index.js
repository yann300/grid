const fs = require('fs')
const path = require('path')
const url = require('url')
const net = require('net')

const createRenderer = require('./electron-shell')
const { setupRpc } = require('./Rpc')
const { getMenuTemplate } = require('./Menu')

const { registerGlobalPluginHost } = require('./ethereum_clients/PluginHost')
const { registerGlobalAppManager } = require('./grid_apps/AppManager')
const { registerGlobalUserConfig } = require('./Config')

const is = require('./utils/main/is')
const { checkConnection } = require('./utils/main/util')

registerGlobalUserConfig()

const log = {
  dev: require('debug')('dev'),
  appManager: {
    log: require('debug')('AppManager')
  }
}

const { app, dialog, Menu } = require('electron')

const {
  AppManager,
  registerPackageProtocol
} = require('@philipplgh/electron-app-manager')
registerPackageProtocol()

const CONFIG_NAME = '.shell.config.js'

// hw acceleration can cause problem in VMs and in certain APIs
app.disableHardwareAcceleration()

const shellManager = new AppManager({
  repository: 'https://github.com/yann300/grid',
  auto: true,
  electron: true
})

AppManager.on('menu-available', updaterTemplate => {
  const template = getMenuTemplate()

  // replace old updater menu with new one
  const idx = template.findIndex(mItem => mItem.label === 'Updater')
  template[idx] = updaterTemplate

  updaterTemplate.submenu.push({
    id: 'check',
    label: 'Check Update',
    click: function() {
      shellManager.checkForUpdatesAndNotify(true)
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
})

// TODO util
app.on('web-contents-created', (event, contents) => {
  // https://electronjs.org/docs/tutorial/security#11-verify-webview-options-before-creation
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    // Strip away preload scripts if unused or verify their location is legitimate
    delete webPreferences.preload
    delete webPreferences.preloadURL

    console.log('will attach webview')

    webPreferences.preload = path.join(__dirname, 'preload-webview')

    // Disable Node.js integration
    webPreferences.nodeIntegration = false
  })
})

// Step 1 - configure and start user interface
const startWithDevConfig = async appUrl => {
  const {
    packagePath,
    packageServer,
    packageUrl,
    packageVersion
  } = require(`./${CONFIG_NAME}`)
  // test if local path configured
  if (packagePath && fs.existsSync(packagePath)) {
    log.dev('load user provided package from fs:', packagePath)
    appUrl = await appManager.load(packagePath)
  }
  // test if user provided server is defined and reachable
  else if (packageServer) {
    const { hostname, port } = url.parse(packageServer)
    const isServerRunning = await checkConnection(hostname, port)
    if (isServerRunning) {
      log.dev('load user provided package url:', packageServer)
      appUrl = packageServer
    } else {
      log.dev('user provided server unreachable:', packageServer)
    }
  }
  // fallback to user defined package url
  else if (packageUrl) {
    throw Error('not implemented')
  } else if (packageVersion) {
    log.dev('load user provided version:', packageVersion)
    const releases = await appManager.getReleases()
    // console.log(releases.map(r => r.version).join(', '))
    const release = releases.find(r => r.version === packageVersion)
    if (release) {
      appUrl = await appManager.hotLoad(release)
    } else {
      log.dev('user provided version not found')
    }
  }
  // else: display error: module not found
  mainWindow = createRenderer(appUrl)
}
const startUI = async () => {
  let errorUrl = url.format({
    slashes: true,
    protocol: 'file:',
    pathname: path.join(__dirname, 'public', 'error.html')
  })

  if (is.dev()) {
    const template = getMenuTemplate()
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))

    // load user-provided package if possible
    if (fs.existsSync(path.join(__dirname, CONFIG_NAME))) {
      const { useDevSettings } = require(`./${CONFIG_NAME}`)
      if (useDevSettings) {
        return startWithDevConfig(errorUrl)
      }
    }
    // else:  no dev config found or deactivated -> use default = dev server
    const PORT = '3080'
    const appUrl = `http://localhost:${PORT}/index.html`
    const isServerRunning = await checkConnection('localhost', PORT)
    if (!isServerRunning) {
      log.dev('dev server unreachable at:', appUrl)
      dialog.showMessageBox({
        title: 'Error',
        message: 'Dev Server not running or unreachable at: ' + appUrl
      })
      return
    }
    // else: server running -> display app
    mainWindow = createRenderer(appUrl)

    return
  }

  // else is production:
  // const appUrl = 'package://github.com/ethereum/remix-ide'
  const appUrl = 'https://remix-alpha.ethereum.org'
  mainWindow = createRenderer(appUrl)
  return
  /*
  // else: no valid app url -> display error
  mainWindow = createRenderer(errorUrl)
  */
}

// ########## MAIN APP ENTRY POINT #########
const onReady = async () => {
  const pluginHost = registerGlobalPluginHost()

  pluginHost.on('plugins-loaded', async () => {
    // FIXME don't defer start
    // 1. start UI for quick user-feedback without long init procedures
    await startUI()
  })

  const appManager = registerGlobalAppManager()
}
app.once('ready', onReady)
