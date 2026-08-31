#!/usr/bin/env node

const fs = require('fs')
const { join, basename } = require('path')

const VERSION = '26.3-snapshot-10'
const MAJOR_VERSION = '26.3'
const PREV = '26.2'
const PROTOCOL = 1073742156
const RELEASE_TYPE = 'snapshot'

const root = join(__dirname, '..', '..')
const data = join(root, 'data')
const pc = join(data, 'pc')

const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf-8'))
const writeJSON = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf-8')
const log = (...a) => console.log(' ', ...a)

if (!fs.existsSync(join(pc, 'common', 'versions.json'))) {
  console.error('Ce script doit etre lance depuis tools/js/ dans un clone de minecraft-data.')
  process.exit(1)
}

// ---------------------------------------------------------------- 1. version.json
fs.mkdirSync(join(pc, VERSION), { recursive: true })
const versionPath = join(pc, VERSION, 'version.json')
if (!fs.existsSync(versionPath)) {
  writeJSON(versionPath, {
    version: PROTOCOL,
    minecraftVersion: VERSION,
    majorVersion: MAJOR_VERSION,
    releaseType: RELEASE_TYPE
  })
  log(`cree data/pc/${VERSION}/version.json`)
} else {
  log(`data/pc/${VERSION}/version.json deja present`)
}

// ---------------------------------------------------------------- 2. protocolVersions.json
const protoVersionsPath = join(pc, 'common', 'protocolVersions.json')
const protoVersions = readJSON(protoVersionsPath)
if (!protoVersions.find(v => v.minecraftVersion === VERSION)) {
  protoVersions.unshift({
    minecraftVersion: VERSION,
    version: PROTOCOL,
    usesNetty: true,
    majorVersion: MAJOR_VERSION,
    releaseType: RELEASE_TYPE
  })
  writeJSON(protoVersionsPath, protoVersions)
  log(`ajoute ${VERSION} a protocolVersions.json`)
} else {
  log(`protocolVersions.json contient deja ${VERSION}`)
}

// ---------------------------------------------------------------- 3. versions.json
const versionsPath = join(pc, 'common', 'versions.json')
const versions = readJSON(versionsPath)
if (!versions.includes(VERSION)) {
  versions.push(VERSION)
  writeJSON(versionsPath, versions)
  log(`ajoute ${VERSION} a versions.json`)
} else {
  log(`versions.json contient deja ${VERSION}`)
}

// ---------------------------------------------------------------- 4. proto.yml : latest passe de 26.2 a 26.3-snapshot-10
const latestProtoPath = join(pc, 'latest', 'proto.yml')
let protoYml = fs.readFileSync(latestProtoPath, 'utf-8')
const currentProtoVersion = protoYml.match(/!version: ([0-9a-zA-Z.-]+)/)[1]

if (currentProtoVersion === PREV) {
  const frozen = join(pc, PREV, 'proto.yml')
  if (!fs.existsSync(frozen)) {
    fs.copyFileSync(latestProtoPath, frozen)
    log(`fige l'ancien proto.yml dans data/pc/${PREV}/`)
  }
  protoYml = protoYml.replace(/!version: [0-9a-zA-Z.-]+/, `!version: ${VERSION}`)
  fs.writeFileSync(latestProtoPath, protoYml, 'utf-8')
  log(`latest/proto.yml passe a !version: ${VERSION}`)
} else if (currentProtoVersion !== VERSION) {
  console.error(`latest/proto.yml est sur ${currentProtoVersion}, attendu ${PREV} ou ${VERSION}. Abandon.`)
  process.exit(1)
}

// ---------------------------------------------------------------- 5. deltas de protocole 26.2 -> 26.3-snapshot-10
// play.toClient.packet_player_info : gamemode passe de varint a i8
//   (ClientboundPlayerInfoUpdatePacket.Action.UPDATE_GAME_MODE lit desormais
//    GameType.byId(input.readByte()) au lieu de GameType.STREAM_CODEC (varint),
//    par coherence avec SpawnInfo.gamemode qui est deja en i8)
const eol = protoYml.includes('\r\n') ? '\r\n' : '\n'
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const asRegex = lines => new RegExp(lines.map(escape).join('\\r?\\n'))

const edits = [
  {
    name: 'packet_player_info.gamemode_i8',
    marker: 'if true: i8\n            default: void',
    anchor: [
      '         gamemode: ../action/update_game_mode ?',
      '            if true: varint',
      '            default: void'
    ],
    replacement: [
      '         gamemode: ../action/update_game_mode ?',
      '            if true: i8',
      '            default: void'
    ]
  }
]
for (const edit of edits) {
  if (protoYml.includes(edit.marker)) {
    log(`${edit.name} deja applique`)
    continue
  }
  const rx = asRegex(edit.anchor)
  if (!rx.test(protoYml)) {
    console.error(`Impossible de localiser le bloc pour ${edit.name}, a faire a la main.`)
    continue
  }
  protoYml = protoYml.replace(rx, edit.replacement.join(eol))
  fs.writeFileSync(latestProtoPath, protoYml, 'utf-8')
  log(`applique ${edit.name}`)
}

// ---------------------------------------------------------------- 6. dataPaths.json
const dataPathsPath = join(data, 'dataPaths.json')
const dataPaths = readJSON(dataPathsPath)

for (const v in dataPaths.pc) {
  if (v !== VERSION && dataPaths.pc[v].proto === 'pc/latest') {
    dataPaths.pc[v].proto = `pc/${PREV}`
    log(`dataPaths: ${v}.proto -> pc/${PREV}`)
  }
}
if (!dataPaths.pc[VERSION]) {
  const entry = structuredClone(dataPaths.pc[PREV])
  entry.protocol = `pc/${VERSION}`
  entry.version = `pc/${VERSION}`
  entry.proto = 'pc/latest'
  dataPaths.pc[VERSION] = entry
  log(`dataPaths: entree ${VERSION} creee (heritage de ${PREV})`)
}

// ---------------------------------------------------------------- 7. donnees du generateur (optionnel)
const srcDir = process.argv[2]
if (srcDir) {
  if (!fs.existsSync(srcDir)) {
    console.error(`Dossier introuvable : ${srcDir}`)
    process.exit(1)
  }
  const entry = dataPaths.pc[VERSION]
  const copied = []
  const unknown = []
  for (const file of fs.readdirSync(srcDir)) {
    if (!file.endsWith('.json')) continue
    const key = basename(file, '.json')
    if (key === 'version' || key === 'protocol') continue
    fs.copyFileSync(join(srcDir, file), join(pc, VERSION, file))
    if (key in entry) {
      entry[key] = `pc/${VERSION}`
      copied.push(key)
    } else {
      unknown.push(key)
    }
  }
  log(`copie ${copied.length} fichiers : ${copied.sort().join(', ')}`)
  if (unknown.length) log(`cles absentes de dataPaths (a verifier) : ${unknown.join(', ')}`)

  const stillInherited = Object.entries(entry)
    .filter(([k, v]) => v !== `pc/${VERSION}`)
    .map(([k, v]) => `${k}=${v}`)
  log(`herite encore : ${stillInherited.join(', ')}`)
} else {
  log(`pas de dossier de sortie fourni : items/blocks/... heritent encore de ${PREV}`)
}

writeJSON(dataPathsPath, dataPaths)

// ---------------------------------------------------------------- 8. README
const readmePath = join(root, 'README.md')
let readme = fs.readFileSync(readmePath, 'utf-8')
if (!readme.includes(`, ${VERSION}\n<!--NEXT PC-->`)) {
  readme = readme.replace('\n<!--NEXT PC-->', `, ${VERSION}\n<!--NEXT PC-->`)
  fs.writeFileSync(readmePath, readme, 'utf-8')
  log('README mis a jour')
}

console.log(`
Termine. Etapes suivantes, depuis tools/js :

  npm install
  node compileProtocol.js pc latest        # genere data/pc/${VERSION}/protocol.json`)
if (srcDir) {
  console.log(`  node extractPcEntityMetadata.js ${VERSION}   # metadonnees d'entites (entities.json + protocol.json)
  node extractPcFoods.js ${VERSION}            # recalcule foods.json depuis les sources decompilees`)
}
console.log(`  npm test                                 # validation des schemas
`)
