import fs from 'fs'

import xattr from 'fs-xattr'
import UUID from 'node-uuid'
import validator from 'validator'
import shallowequal from 'shallowequal'

function parseJSON(string) {

  let json
  try {
    json = JSON.parse(string) 
    return json
  }
  catch (e) {
    return
  }
}

function defaultXattrVal() {

  return {
    uuid: UUID.v4(),
    owner: null,
    writelist: null,
    readlist: null,
    hash: null,
    htime: -1 // epoch time value, i.e. Date object.getTime()
  }
}

// path must be absolute path, never reject
async function fsStatAsync(path) {
  return new Promise(resolve => {
    fs.stat(path, (err, stats) => {
      err ? resolve(err) : resolve(stats)
    }) 
  })
}

async function readTimeStampAsync(path) {

  let stats = await fsStatAsync(path)
  if (stats instanceof Error) return stats

  return stats.mtime.getTime()
}

async function xattrGetAsync(path, attr) {
  return new Promise(resolve => {
    xattr.get(path, attr, (err, val) => {
      err ? resolve(err) : resolve(val)
    })
  })
}

async function xattrSetAsync(path, attr, val) {
  return new Promise(resolve => {
    xattr.set(path, attr, val, err => {
      err ? resolve(err) : resolve(null)
    })
  })
}

async function xattrGetRawAsync(path, attr) {

  let val = await xattrGetAsync(path, attr)
  if (val instanceof Error) return val

  let parsed = parseJSON(val)
  return parsed
}

function xattrGetRaw(path, attr, callback) {

  xattrGetRawAsync(path, attr)
    .then(r => {
      if (r instanceof Error) callback(r)
      else callback(null, r)  
    })
    .catch(e => callback(e))
}

// get xattr, parsed, 
// defval: if provided, will be set if there is no valid xattr; 
// if not provided (undefined or null), won't try to set
async function xattrGetOrDefault(path, attr, defVal) {

  let defJsonVal = JSON.stringify(defVal)

  let val = await xattrGetAsync(path, attr)
  if (val instanceof Error) {

    if (!defVal) return val

    let err = await xattrSetAsync(path, attr, defJsonVal)
    if (err instanceof Error) return err
    return defVal
  }

  let parsed = parseJSON(val)
  if (parsed === undefined) {
    let err = await xattrSetAsync(path, attr, defJsonVal)
    if (err instanceof Error) return err
    return defVal
  }
  
  return parsed
}

//
// opts
//
// forceOwner: if exists, overwrite existing
// defaultOwner: 
// forcePermission: 
// defaultPermission:

// this function returns extended stats, 
// i.e, merged stats and extended attributes, with hash timestamp verified

/**
async function readXstatAsync(path, opts) {

  let props = {
    uuid: UUID.v4(),
    owner: null,
    writelist: null,
    readlist: null,
    hash: null,
    htime: -1 // epoch time value, i.e. Date object.getTime()
  }

  let stats = await fsStatAsync(path)
  if (stats instanceof Error) return stats

  let attr = await xattrGetAsync(path, 'user.fruitmix')
  if (attr instanceof Error && attr.code !== 'ENODATA') return attr

  if (attr instanceof Error) { // ENODATA

    if (opts) {
      if (opts.forceOwner) props.owner = opts.forceOwner
      else if (opts.owner) props.owner = opts.owner

      if (opts.forceWritelist) props.writelist = opts.forceWritelist
      else if (opts.writelist) props.writelist = opts.writelist

      if (opts.forceReadlist) props.readlist = opts.forceReadlist
      else if (opts.readlist) props.readlist = opts.readlist
    }   

    await xattrSetAsync(path, 'user.fruitmix', JSON.stringify(props)) 
    return Object.assign(stats, props, { abspath: path})
  }

  // DANGER! FIXME
  attr = parseJSON(attr)

  if (opts && opts.forceOwner) props.owner = opts.forceOwner
  else if (opts && opts.owner && !attr.owner) props.owner = opts.owner
  else if (attr.owner) props.owner = attr.owner

  if (opts && opts.forceWritelist) props.writelist = opts.writelist
  else if (opts && opts.writelist && !attr.writelist) props.writelist = opts.writelist
  else if (attr.writelist) props.writelist = attr.writelist

  if (opts && opts.forceReadlist) props.readlist = opts.readlist
  else if (opts && opts.readlist && !attr.readlist) props.readlist= opts.readlist
  else if (attr.readlist) props.readlist = attr.readlist

  props.uuid = attr.uuid

  if (attr.htime === stats.mtime.getTime()) {
    props.hash = attr.hash
    props.htime = attr.htime
  }

  if (!shallowequal(props, attr)) {
    await xattrSetAsync(path, 'user.fruitmix', JSON.stringify(props))
  } 

  return Object.assign(stats, props, { abspath: path })

//  let defVal = defaultXattrVal()
//
//  let stats = await fsStatAsync(path)
//  if (stats instanceof Error) return stats
//
//  let attr = await xattrGetOrDefault(path, 'user.fruitmix', defVal)
//  if (attr instanceof Error) return attr
//
//  // verify hash timestamp
//  if (attr.htime !== stats.mtime.getTime()) {
//     attr.hash = null 
//  } 
//
//  // remove htime
//  delete attr.htime
//
//  return Object.assign(stats, attr, {
//    abspath: path
//  })
}

**/

async function readXstatAsync(path, opts) {

  return new Promise(resolve => {
    let callback = (err, xstat) => err ? resolve(err) : resolve(xstat)
    opts ? readXstat(path, opts, callback) : readXstat(path, callback)
  })
}

function validateRWList(list) {

  if (list === null) return true
  if (!Array.isArray(list)) return false
  if (list.length === 0) return true
  return list.every(l => typeof l === 'string' && validator.isUUID(l))
}

function validateOwner(owner) {

  if (!Array.isArray(owner)) return false
  if (owner.length !== 1) return false
  if (typeof owner[0] !== 'string') return false
  if (!validator.isUUID(owner[0])) return false
  return true
}

function validateHash(hash) {

  if (hash === null) return true
  if (!(typeof hash === 'string')) return false
  // TODO regex test
  return true 
}

function validateXattr(attr) {

  if (!attr.uuid) return false
  if (!(typeof attr.uuid === 'string')) return false
  if (!validator.isUUID(attr.uuid)) return false

  if (!attr.owner || !validateOwner(attr.owner)) return false
  if (!attr.writelist || !validateRWList(attr.writelist)) return false
  if (!attr.readlist || !validateRWList(attr.readlist)) return false

  if (!validateHash(attr.hash)) return false
  if (!(typeof attr.htime === 'number')) return false

  return true 
}


function filterUUIDList(list) {
  return list.filter(u => typeof u === 'string' && validator.isUUID(u))
}

function fixBadXattr(attr, owner) {

  if (!owner) throw new Error('owner must be provided for fixBadXattr')

  if (!attr.uuid) return null
  if (!(typeof attr.uuid === 'string')) return null
  if (!validator.isUUID(attr.uuid)) return null

  if (!attr.owner || !Array.isArray(owner))
    attr.owner = owner
  else {
    attr.owner = filterUUIDList(attr.owner)
    if (attr.owner.length === 0) attr.owner = owner
  }

  if (!attr.writelist || !Array.isArray(attr.writelist)) 
    attr.writelist = null
  else  
    attr.writelist = filterUUIDList(attr.writelist)

  if (!attr.readlist || !Array.isArray(attr.readlist))
    attr.readlist = null
  else
    attr.readlist = filterUUIDList(attr.readlist)

  if (attr.writelist || attr.readlist) {
    if (attr.writelist === null) attr.writelist = []
    if (attr.readlist === null) attr.readlist = []
  }

  if (!validateHash(attr.hash) || !(typeof attr.htime === 'number')) {
    attr.hash = null
    attr.htime = -1 
  }

  return attr
}

function newXattr(owner, writelist, readlist) {

  if (!validateRWList(writelist)) throw new Error('writelist invalid')
  if (!validateRWList(readlist)) throw new Error('readlist invalid')
  if (!validateOwner(owner)) throw new Error('owner invalid') 

  if (writelist || readlist) {
    if (writelist === null) writelist = []
    if (readlist === null) readlist = []
  }

  return {
    uuid: UUID.v4(),
    owner: owner,
    writelist: writelist,
    readlist: readlist,
    hash: null,
    htime: -1
  }
}


// performance critical version
function readXstat2(path, perm, callback) {

  if (!validateOwner(perm.owner)) return callback(new Error('owner is not provided or invalid'))

  fs.stat(path, (err, stats) => {

    if (err) return callback(err)
    xattr.get(path, 'user.fruitmix', (err, attr) => {

      let parsed, fixed, invalid = false

      if (err && err.code !== 'ENODATA') return callback(err)
      if (!err) {
        parsed = parseJSON(attr)
        if (!validateXattr(parsed)) {
          invalid = true
          fixed = fixBadXattr(parsed, perm.owner)
        }
      }
      
      // non-exist, or json invalid, or bad and can't be fixed
      if (err || !parsed || (invalid && fixed === null)) {

        let props = {}
        // since xattr does not exist, it doesn't matter if force is true or false
        props.uuid = UUID.v4()
        props.owner = perm.owner
        props.writelist = perm.writelist ? perm.writelist : null
        props.readlist = perm.readlist ? perm.readlist : null
        props.hash = null,
        props.htime = -1

        xattr.set(path, 'user.fruitmix', JSON.stringify(props), err => {
          if (err) return callback(err)
          return callback(null, Object.assign(stats, props, { abspath: path }))
        })
        return // !
      }   

      let good = invalid ? fixed : parsed
      if (good.htime !== stats.mtime.getTime()) {
        good.hash = null
        good.htime = -1
      }

      if (!shallowequal(good, parsed)) {
        xattr.set(path, 'user.fruitmix', JSON.stringify(good), err => {
          if (err) return callback(err) 
          return callback(null, Object.assign(stats, good, { abspath: path }))
        })
      } 

      callback(null, Object.assign(stats, good, { abspath: path }))
    }) // xattr.get
  })
}

// performance critical version
function readXstat(path, opts, callback) {

  if (typeof opts === 'function') {
    callback = opts
    opts = null
  }

  let props = {
    uuid: UUID.v4(),
    owner: null,
    writelist: null,
    readlist: null,
    hash: null,
    htime: -1
  }

  fs.stat(path, (err, stats) => {

    if (err) return callback(err)
    xattr.get(path, 'user.fruitmix', (err, attr) => {

      let parsed

      // err, not non-exist
      if (err && err.code !== 'ENODATA') return callback(err)

      // try parse attr if no error
      if (!err) parsed = parseJSON(attr) 
      
      // non-exist, or json invalid
      if (err || !parsed) {

        if (opts) {
          if (opts.forceOwner) props.owner = opts.forceOwner
          else if (opts.owner) props.owner = opts.owner

          if (opts.forceWritelist) props.writelist = opts.forceWritelist
          else if (opts.writelist) props.writelist = opts.writelist

          if (opts.forceReadlist) props.readlist = opts.forceReadlist
          else if (opts.readlist) props.readlist = opts.readlist
        } 

        xattr.set(path, 'user.fruitmix', JSON.stringify(props), err => {
          if (err) return callback(err)
          return callback(null, Object.assign(stats, props, { abspath: path }))
        })
        return // !
      }   

      // xattr exist and valid
      props.uuid = parsed.uuid

      if (opts && opts.forceOwner) props.owner = opts.forceOwner
      else if (opts && opts.owner && !parsed.owner) props.owner = opts.owner
      else if (parsed.owner) props.owner = parsed.owner

      if (opts && opts.forceWritelist) props.writelist = opts.writelist
      else if (opts && opts.writelist && !parsed.writelist) props.writelist = opts.writelist
      else if (parsed.writelist) props.writelist = parsed.writelist

      if (opts && opts.forceReadlist) props.readlist = opts.readlist
      else if (opts && opts.readlist && !parsed.readlist) props.readlist= opts.readlist
      else if (parsed.readlist) props.readlist = parsed.readlist

      if (parsed.htime === stats.mtime.getTime()) {
        props.hash = parsed.hash
        props.htime = parsed.htime
      }

      if (!shallowequal(props, parsed)) {
        xattr.set(path, 'user.fruitmix', JSON.stringify(props), err => {
          if (err) return callback(err) 
          return callback(null, Object.assign(stats, props, { abspath: path }))
        })
      } 

      callback(null, Object.assign(stats, props, { abspath: path }))
      
    }) // xattr.get
  })
}

/**
function readXstat(path, callback) {

  readXstatAsync(path)
    .then(r => (r instanceof Error) ? callback(r) : callback(null, r))
    .catch(e => callback(e))
}
**/

async function updateXattrPermissionAsync(path, permission) {
  
  let defVal = defaultXattrVal()

  let attr = await xattrGetOrDefault(path, 'user.fruitmix', defVal) 
  if (attr instanceof Error) return attr

  let perm = {}
  if (permission.owner) perm.owner = permission.owner
  if (permission.readlist) perm.readlist = permission.readlist
  if (permission.writelist) perm.writelist = permission.writelist

  let newattr = Object.assign({}, attr, perm) 
  let err = await xattrSetAsync(path, 'user.fruitmix', JSON.stringify(newattr))
  return err
}



async function updateXattrHashAsync(path, hash, htime) {
  
  let defVal = defaultXattrVal()

  let stats = await fsStatAsync(path)
  if (stats instanceof Error) return stats

  if (stats.mtime.getTime() !== htime) {

    let e = new Error('htime outdated')
    e.code = 'ETIMESTAMP_OUTDATED'
    return e 
  }

  let attr = await xattrGetOrDefault(path, 'user.fruitmix', defVal)
  if (attr instanceof Error) return attr

  attr.hash = hash
  attr.htime = htime 

  return await xattrSetAsync(path, 'user.fruitmix', JSON.stringify(attr))
}

let testing = {
  xattrGetRaw,
  xattrGetRawAsync,
  xattrGetOrDefault
}

export { 
  readTimeStampAsync,
  readXstat,
  readXstat2,
  readXstatAsync,
  updateXattrPermissionAsync,
  updateXattrHashAsync,
  testing
}





















