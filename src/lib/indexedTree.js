import EventEmitter from 'events'
import deepEqual from 'deep-equal'

// These are tree node operations
const nodeProperties = {

  root() {
    let node = this
    while (node.parent !== null) node = node.parent
    return node
  },

  setChild(child) {
    this.children ? this.children.push(child) : this.children = [child]
  },

  unsetChild(child) {
    let children = this.children
    if (children === undefined) throw new Error('Node has no children')
    let index = children.findIndex(c => c === child)
    if (index === -1) throw new Error('Node has no such child')
    children.splice(index, 1)
    if (children.length === 0) delete this.children 
  },

  getChildren() {
    return this.children ? this.children : []
  },

  attach(parent) {
    if (this.parent) throw new Error('node is already attached')
    this.parent = parent
    parent.setChild(this)
  },

  detach() {
    if (this.parent === null) throw new Error('Node is already detached')
    this.parent.unsetChild(this)
    this.parent = null   
  },

  upEach(func) {
    let node = this
    while (node !== null) {
      func(node)
      node = node.parent
    }
  },

  upFind(func) {
    let node = this
    while (node !== null) {
      if (func(node)) return node
      node = node.parent
    }
  },

  nodepath() {
    let q = []
    this.upEach(node => q.unshift(node))
    return q
  }, 

  preVisit(func) {
    func(this)
    if (this.children) 
      this.children.forEach(child => child.preVisit(func)) 
  },

  postVisit(func) {
    if (this.children)
      this.children.forEach(child => child.postVisit(func))
    func(this) 
  },

  preVisitEol(func) {
    if (func(this) && this.children)
      this.children.forEach(child => child.preVisitEol(func))  
  },

  preVisitFind(func) {
    if (func(this)) return this
    if(this.children === undefined) return undefined
    return this.children.find(child => child.preVisitFind(func))
  },

  isFile() {
    return this.type === 'file'
  },

  isDirectory() {
    return this.type === 'folder'
  }
}

// to prevent unexpected modification
Object.freeze(nodeProperties)

class IndexedTree extends EventEmitter {

  // proto can be any plain JavaScript object
  // root should have at least the uuid for this general data structure
  // for fruitmix specific usage, root should have owner, writelist and readlist
  constructor(proto) {

    super()    

    this.proto = Object.assign(proto, nodeProperties)
    this.proto.tree = this

    // for accessing node by UUID
    this.uuidMap = new Map()
    // file only, examine magic and conditionally put node into map
    this.hashMap = new Map()
    // file only, for file without hashmagic
    this.hashless = new Set()
    // folder only, for folder with writer/reader other than drive owner
    this.shared = new Set()

    this.root = null
  } 

  //
  verify(node) {
    
  }

  //
  uuid() {
    return this.root.uuid
  }

  // parent, children 
  // uuid, type
  // owner, writelist, readlist
  // mtime, size
  // hash

  // using whitelist for props, aka, builder pattern, this will
  // ease the indexing maintenance when updating props
  createNode(parent, props) {

    // create empty object
    let node = Object.create(this.proto)

    // set uuid
    if (!props.uuid) throw new Error('props must have uuid property')
    node.uuid = props.uuid 

    // set type
    if (!props.type) throw new Error('props must have type property')
    if (props.type !== 'file' && props.type !== 'folder') throw new Error('type must be file or folder')
    if (parent === null && props.type !== 'folder') throw new Error('root object type must be folder')
    node.type = props.type

    // set name
    node.name = props.name

    // set owner if different from proto
    if (!deepEqual(props.owner, this.proto.owner)) {
      node.owner = props.owner
    }

    // set writelist and readlist if any
    if (props.writelist) {
      node.writelist = props.writelist
      node.readlist = props.readlist
    }

    // size and mtime
    if (node.isFile()) {
      node.size = props.size
      node.mtime = props.mtime
    }

    // set structural relationship
    if (parent === null) {
      if (this.root) throw new Error('root already set')
      node.parent = null // TODO: should have a test case for this !!! this may crash forEach
      this.root = node
    }
    else {
      node.attach(parent)
    }
     
    // set uuid indexing
    this.uuidMap.set(node.uuid, node)

    // set digest indexing for file, or shared for folder
    if (node.isFile()) {
      this.fileHashInstall(node, props.hash, props.magic)
    }
    else if (node.isDirectory()) {
      if (node.writelist) this.shared.add(node)  
    }

    return node
  }

  createNodeByUUID(parentUUID, content) {

    let parent = this.uuidMap.get(parentUUID)
    if (!parent) return null
    return this.createProtoNode(parent, content)
  }

  fileHashInstall(node, hash, magic) {

    if (!hash) {
      this.hashless.add(node)
      if (this.hashless.size === 1) {
        this.emit('hashlessNonEmpty')
      }
      return
    }
    
    let digestObj = this.hashMap.get(hash)
    if (digestObj) {
      digestObj.nodes.push(node)
      return 
    } 

    let meta = magicToMeta(magic)
    if (meta) {
      digestObj = {
        meta,
        nodes: [node]
      }
      this.hashMap.set(hash, digestObj)
      node.hash = hash
    }
  }

  fileHashUninstall(node) {

    // if no hash
    if (!node.hash) {
      if (this.hashless.has(node)) {
        this.hashless.delete(node)
        if (this.hashless.size === 0) {
          this.emit('hashlessEmpty')
        }
      }
      return
    }

    let hash = node.hash // TODO

    // retrieve digest object
    let digestObj = this.hashMap.get(node.hash)
    if (!digestObj) throw new Error('hash (' + node.hash + ') not found in hashmap)')
    
    // find in node array
    let index = digestObj.nodes.find(x => x === node)
    if (index === -1) throw new Error('hash (' + node.hash + ') not found in digest object node array')

    // remove and delete hash property
    digestObj.nodes.splice(index, 1)
    delete node.hash

    // destory digest object if this is last one
    if (digestObj.nodes.length === 0)
      this.hashMap.delete(hash)
  }

  updateHashMagic(node, hash, magic) {

    this.fileHashUninstall(node)
    this.fileHashInstall(node, hash, magic)
  }

  updateOwner(node, owner) {
    node.owner = owner 
  }

  updateShare(node, writelist, readlist) {

    if (writelist) 
      node.writelist = writelist
    else
      delete node.writelist

    if (readlist)
      node.readlist = readlist
    else
      delete node.readlist

    if (node.writelist)
      this.shared.add(node)
    else
      this.shared.delete(node)
  }

  updateName(node, name) {
    node.name = name
  }

  updateMtime(node, mtime) {
    if (!node.isFile()) throw new Error('only file allows mtime update')
    node.mtime = mtime
  }

  // this function delete one leaf node
  // for delete a sub tree, using higher level method
  deleteNode(node) {

    if (node.children) throw new Error('node has children, cannot be deleted')

    if (node.isFile()) {
      this.fileHashUninstall(node)
    }
    else if (node.isDirectory()) {
      this.shared.delete(node) // ignore true or false
    }
    
    this.uuidMap.delete(node.uuid) 
    if (node === this.root) {
      this.root = null
    }
    else {
      node.detach()
    }
  }

  deleteNodeByUUID(uuid) {
    let node = this.uuidMap.get(uuid)
    if (!node) return null
    this.deleteNode(node)
  }

  deleteSubTree(node) {
    node.postVisit(n => n.tree.deleteNode(n)) 
  }
}

export { nodeProperties, IndexedTree } 
