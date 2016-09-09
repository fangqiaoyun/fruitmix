import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { Router } from 'express'

import formidable from 'formidable'
import UUID from 'node-uuid'
import validator from 'validator'
import sanitize from 'sanitize-filename'

import auth from '../middleware/auth'
import Models from '../models/models'

const router = Router()

// this may be either file or folder
// if it's a folder, return childrens
// if it's a file, download
// /files/xxxxxxx <- must be folder
router.get('/:nodeUUID', auth.jwt(), (req, res) => {

  let repo = Models.getModel('repo')
  let user = req.user

  let node = repo.findNodeByUUID(req.params.nodeUUID) 
  if (!node) {
    return res.status(500).json({
      code: 'ENOENT',
      message: 'node not found'
    })
  }

  if (node.isDirectory()) {
    let ret = repo.listFolder(user.uuid, node.uuid)
    if (ret instanceof Error) {
      res.status(500).json({
        code: ret.code,
        message: ret.message
      })
    }
    else {
      res.status(200).json(ret)
    }
  }
  else {
    let filepath = repo.getFilePath(user.uuid, node.uuid)
    res.status(200).sendFile(filepath)
  }
})

// this can only be folders
// create a subfolder or a file in folder
router.post('/:nodeUUID', auth.jwt(), (req, res) => {
  
  let repo = Models.getModel('repo')
  let user = req.user

  let node = repo.findNodeByUUID(req.params.nodeUUID)
  if (!node) {
    return res.status(500).json({ // TODO
      code: 'ENOENT'
    })
  }

  // this is going to create something in folder, either file or folder
  if (node.isDirectory()) {

    if (req.is('multipart/form-data')) {  // uploading a new file into folder

      let sha256, abort = false

      let form = new formidable.IncomingForm()
      form.hash = 'sha256'
      form.on('field', (name, value) => {
        if (name === 'sha256') 
          sha256 = value
      })
      form.on('fileBegin', (name, file) => {
        if (sanitize(file.name) !== file.name) {
          abort = true
          return res.status(500).json({})  // TODO
        }
        if (node.getChildren().find(child => child.name === file.name)) {
          abort = true
          return res.status(500).json({}) // TODO
        }
        file.path = path.join(repo.getTmpFolderForNode(node), UUID.v4())
      })

      form.on('file', (name, file) => {
        if (abort) return
        if (sha256 !== file.hash) {
          return fs.unlink(file.path, err => {
            res.status(500).json({})  // TODO
          })
        }
        
        node.tree.createFile(user.uuid, file.path, node, file.name, (err, newNode) => {
          return res.status(200).json(Object.assign({}, newNode, {
            parent: newNode.parent.uuid,
          }))
        })
      })

      // this may be fired after user abort, so response is not guaranteed to send
      form.on('error', err => {
        abort = true
        return res.status(500).json({
          code: err.code,
          message: err.message
        })
      })

      form.parse(req)
    }
    else { // creating a new sub-folder in folder
    
      let name = req.body.name
      if (typeof name !== 'string' || sanitize(name) !== name) {
        return res.status(500).json({}) // TODO
      }

      node.tree.createFolder(user.uuid, node, name, (err, newNode) => {
        if (err) return res.status(500).json({}) // TODO
        res.status(200).json(Object.assign({}, newNode, {
          parent: newNode.parent.uuid
        }))
      })
    }
  }
  else if (node.isFile()) {     

    if (req.is('multipart/form-data')) { // overwriting an existing file
       
    }
    else {
      //       
    }
  }
})

// rename file or folder inside a folder
router.patch('/:folderUUID/:childUUID', auth.jwt(), (req, res) => {
  res.status(500).end()
})

// this may be either file or folder
router.delete('/:folderUUID/:childUUID', auth.jwt(), (req, res) => {
  res.status(500).end() 
})

export default router

