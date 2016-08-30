import fs from 'fs'
import path from 'path'

import Promise from 'bluebird'
import paths from './paths'
import models from '../models/models'
import { createUserModelAsync } from '../models/userModel'
import { createDriveModelAsync } from '../models/driveModel'
import { createRepo } from '../lib/repo'

let initialized = false

const avail = (req, res, next) => initialized ? next() : res.status(503).end()  

const initAsync = async (sysroot) => {

  // set sysroot to paths
  await paths.setRootAsync(sysroot)
  console.log(`sysroot is set to ${sysroot}`)

  let modelPath = paths.get('models')
  let tmpPath = paths.get('tmp')

  // create and set user model
  let userModelPath = path.join(modelPath, 'users.json')
  let userModel = await createUserModelAsync(userModelPath, tmpPath)
  models.setModel('user', userModel)

  let driveModelPath = path.join(modelPath, 'drives.json')
  let driveModel = await createDriveModelAsync(driveModelPath, tmpPath)
  models.setModel('drive', driveModel)

  let repo = createRepo(paths, driveModel)
  models.setModel('repo', repo)
  
  initialized = true
}

const deinit = () => {
  // there will be race conditon !!! FIXME
  models.clear()
  paths.unsetRoot()  
}

const system = {
  avail,
  init: (sysroot, callback) => 
    initAsync(sysroot)
      .then(r => callback(null))
      .catch(e => callback(e))
}

export default system

