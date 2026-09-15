#!/usr/bin/env node

const fs = require('fs')
const { join, basename, resolve } = require('path')

const VERSION = '26.3-rc-3'
const PREV = '26.3-rc-2'
const MAJOR = '26.3'

const PROTOCOL = parseInt(process.argv[2])
if (!Number.isInteger(PROTOCOL)) {
  console.error(`Usage : node add-${VERSION}.js <protocol_version> [dossier_sortie_generateur]`)
  process.exit(1)
}

// Sous Windows, un chemin entre guillemets qui finit par \ ("...\") fait echapper le
// guillemet fermant : Node recoit alors le chemin avec un " final. On nettoie les
// guillemets et separateurs en fin de chaine avant de resoudre le chemin.
const cleanPath = p => resolve(p.trim().replace(/["']+$/, '').replace(/^["']+/, '').replace(/[\\/]+$/, ''))
const srcArg = process.argv[3] ? cleanPath(process.argv[3]) : null

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

// Verifie la source AVANT de modifier quoi que ce soit, pour ne pas laisser le depot a moitie a jour.
const srcDir = srcArg || join(pc, PREV)
if (!fs.existsSync(srcDir) || !fs.statSync(srcDir).isDirectory()) {
  console.error(`Dossier introuvable : ${srcDir}`)
  process.exit(1)
}

// ---------------------------------------------------------------- 1. version.json
fs.mkdirSync(join(pc, VERSION), { recursive: true })
const versionPath = join(pc, VERSION, 'version.json')
if (!fs.existsSync(versionPath)) {
  writeJSON(versionPath, {
    version: PROTOCOL,
    minecraftVersion: VERSION,
    majorVersion: MAJOR,
    releaseType: 'snapshot'
  })
  log(`cree data/pc/${VERSION}/version.json`)
} else {
  log(`data/pc/${VERSION}/version.json deja present`)
}

// ---------------------------------------------------------------- 2. protocolVersions.json
const protoVersionsPath = join(pc, 'common', 'protocolVersions.json')
const protoVersions = readJSON(protoVersionsPath)
if (!protoVersions.find(v => v.minecraftVersion === VERSION)) {
  const prev = protoVersions.find(v => v.minecraftVersion === PREV)
  if (prev && prev.version === PROTOCOL) {
    log(`attention : ${PROTOCOL} est deja le protocole de ${PREV}, verifie le numero`)
  }
  protoVersions.unshift({
    minecraftVersion: VERSION,
    version: PROTOCOL,
    usesNetty: true,
    majorVersion: MAJOR,
    releaseType: 'snapshot'
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

// ---------------------------------------------------------------- 4. proto.yml : latest passe de PREV a VERSION
// Regex qui accepte les suffixes -rc-N / -snapshot-N (celle d'incrementVersion.js ne les gere pas)
const VER_RX = /!version: ([0-9A-Za-z.-]+)/
const latestProtoPath = join(pc, 'latest', 'proto.yml')
let protoYml = fs.readFileSync(latestProtoPath, 'utf-8')
const currentProtoVersion = protoYml.match(VER_RX)[1]

if (currentProtoVersion === PREV) {
  const frozen = join(pc, PREV, 'proto.yml')
  if (!fs.existsSync(frozen)) {
    fs.copyFileSync(latestProtoPath, frozen)
    log(`fige l'ancien proto.yml dans data/pc/${PREV}/`)
  }
  protoYml = protoYml.replace(VER_RX, `!version: ${VERSION}`)
  fs.writeFileSync(latestProtoPath, protoYml, 'utf-8')
  log(`latest/proto.yml passe a !version: ${VERSION}`)
} else if (currentProtoVersion === VERSION) {
  log(`latest/proto.yml deja sur ${VERSION}`)
} else {
  console.error(`latest/proto.yml est sur ${currentProtoVersion}, attendu ${PREV} ou ${VERSION}. Abandon.`)
  process.exit(1)
}

// ---------------------------------------------------------------- 4b. correctif : paquets vides perdus
// Dans le proto.yml de 26.3-rc-1, les commentaires "# Empty" sont desindentes au meme
// niveau que le nom du paquet. protodef-yaml ne voit alors pas la cle comme un container vide
// et la supprime (ex : packet_ping_start disparait -> protocol.json invalide, ping de statut casse).
function fixEmptyPackets (file) {
  const src = fs.readFileSync(file, 'utf-8')
  const eol = src.includes('\r\n') ? '\r\n' : '\n'
  const lines = src.split(eol)
  let n = 0
  for (let i = 1; i < lines.length; i++) {
    const head = lines[i - 1].match(/^( *)[A-Za-z0-9_]+:\s*$/)
    const cur = lines[i].match(/^( *)# Empty\s*$/)
    if (head && cur && cur[1].length <= head[1].length) {
      lines[i] = head[1] + '   # Empty'
      n++
    }
  }
  if (n) fs.writeFileSync(file, lines.join(eol), 'utf-8')
  return n
}
for (const f of [latestProtoPath, join(pc, PREV, 'proto.yml')]) {
  if (!fs.existsSync(f)) continue
  const n = fixEmptyPackets(f)
  if (n) log(`corrige ${n} paquet(s) vide(s) dans ${f.replace(root, '').replace(/\\/g, '/')}`)
}

// ---------------------------------------------------------------- 5. dataPaths.json
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

// ---------------------------------------------------------------- 6. donnees (generateur, sinon copie de PREV)
log(srcArg ? `donnees depuis ${srcDir}` : `pas de dossier fourni : copie des donnees de ${PREV}`)
{
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

  // Fidorial lit blockTransformer dans items.json : on previent si le generateur ne l'a pas exporte.
  const itemsPath = join(pc, VERSION, 'items.json')
  if (srcArg && fs.existsSync(itemsPath)) {
    const withTransformer = readJSON(itemsPath).filter(i => i.blockTransformer).length
    if (withTransformer === 0) {
      log('attention : aucun item n\'a de blockTransformer, le patch du generateur est-il applique ?')
    } else {
      log(`${withTransformer} items avec blockTransformer`)
    }
  }
}

writeJSON(dataPathsPath, dataPaths)

// ---------------------------------------------------------------- 7. README (respecte les fins de ligne CRLF)
const readmePath = join(root, 'README.md')
let readme = fs.readFileSync(readmePath, 'utf-8')
const marker = '<!--NEXT PC-->'
if (!readme.includes(`, ${VERSION}`)) {
  const eol = readme.includes('\r\n') ? '\r\n' : '\n'
  readme = readme.replace(eol + marker, `, ${VERSION}${eol}${marker}`)
  fs.writeFileSync(readmePath, readme, 'utf-8')
  log('README mis a jour')
}

console.log(`
Termine. Etapes suivantes, depuis tools/js :

  npm install
  npm run build                            # regenere protocol.json (${PREV} et ${VERSION})
  npm test                                 # validation des schemas
`)
