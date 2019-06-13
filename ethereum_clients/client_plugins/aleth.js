let platform

switch (process.platform) {
  case 'win32': {
    platform = 'Windows'
    break
  }
  case 'linux': {
    platform = 'Linux'
    break
  }
  case 'darwin': {
    platform = 'Darwin'
    break
  }
}

module.exports = {
  type: 'client',
  order: 3,
  displayName: 'Aleth',
  name: 'aleth',
  repository: 'https://github.com/ethereum/aleth',
  binaryName: 'aleth',
  filter: {
    name: {
      includes: [platform]
    }
  }
}
