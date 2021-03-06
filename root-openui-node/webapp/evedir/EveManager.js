/// @file EveManager.js

(function( factory ) {
   if ( typeof define === "function" && define.amd ) {
      define( ['JSRootCore'], factory );
   } else if (typeof exports === 'object' && typeof module !== 'undefined') {
      factory(require("./JSRootCore.js"));
   } else {
      if (typeof JSROOT == 'undefined')
        throw new Error('JSROOT is not defined', 'EveManager.js');

      factory(JSROOT);
   }
} (function(JSROOT) {

   "use strict";

   // JSROOT.sources.push("evemgr");

   /** @namespace JSROOT.EVE */
   /// Holder of all EVE-related functions and classes
   JSROOT.EVE = {};

   function EveManager()
   {
      this.map    = {}; // use object, not array
      this.childs = [];
      this.last_json = null;
      this.scene_changes = null;

      this.hrecv = []; // array of receivers of highlight messages

      this.scenes = [];  // list of scene objects

      this.EChangeBits = { "kCBColorSelection": 1, "kCBTransBBox": 2, "kCBObjProps": 4, "kCBVisibility": 8 };
   }

   /** Returns element with given ID */
   EveManager.prototype.GetElement = function(id) {
      return this.map[id];
   }

   EveManager.prototype.addSceneHandler = function(handler) {
      this.scenes.push(handler);
   }

   EveManager.prototype.invokeInOtherScenes = function(scene, fname, arg1, arg2, arg3, arg4) {
      for (var i=0;i<this.scenes.length;++i) {
         var sc = this.scenes[i];
         if ((sc !== scene) && (typeof sc[fname] == "function"))
            sc[fname](arg1, arg2, arg3, arg4);
      }
   }

   /** Attach websocket handle to manager, all communication runs through manager */
   EveManager.prototype.UseConnection = function(handle) {
      this.handle = handle;

      handle.SetReceiver(this);
      handle.Connect();
   }

   /** Called when data comes via the websocket */
   EveManager.prototype.OnWebsocketMsg = function(handle, msg, offset) {

      // if (this.ignore_all) return;

      if (typeof msg != "string") {
         // console.log('ArrayBuffer size ',
         // msg.byteLength, 'offset', offset);
         this.ImportSceneBinary(msg, offset);

         return;
      }

      console.log("msg len=", msg.length, " txt:", msg.substr(0,120), "...");

      var resp = JSON.parse(msg);

      if (resp && resp[0] && resp[0].content == "REveManager::DestroyElementsOf") {

         this.DestroyElements(resp);

      } else if (resp && resp[0] && resp[0].content == "REveScene::StreamElements") {

         this.ImportSceneJson(resp);

      } else if (resp && resp.header && resp.header.content == "ElementsRepresentaionChanges") {

         this.ImportSceneChangeJson(resp);

      }
   }

   EveManager.prototype.executeCommand = function(cmd) {
      if (!cmd || !this.handle) return;
      var obj = { "mir": cmd.func, "fElementId": cmd.elementid, "class": cmd.elementclass };
      this.handle.Send(JSON.stringify(obj));
   }

   /** Configure receiver for scene-respective events. Following event used:
    * onSceneChanged */
   EveManager.prototype.RegisterSceneReceiver = function(id, receiver, func_name) {

      var elem = this.GetElement(id);

      if (!elem) return;

      if (!elem.$receivers) elem.$receivers = [];

      if (elem.$receivers.indexOf(receiver)<0)
         elem.$receivers.push(receiver);
   }

   /** Invoke function on all receiver of scene events - when such function exists */
   EveManager.prototype.callSceneReceivers = function (scene, fname, arg) {
      if (scene.$receivers) {
          for (var i=0; i < scene.$receivers.length; i++) {
              var receiver = scene.$receivers[i];
              if (typeof receiver[fname] == "function")
                 receiver[fname](arg);
          }
      }
  }

   /** returns master id for given element id
    * master id used for highlighting element in all dependent views */
   EveManager.prototype.GetMasterId = function(elemid) {
      var elem = this.map[elemid];
      if (!elem) return elemid;
      return elem.fMasterId || elemid;
   }

   EveManager.prototype.RegisterReceiver = function(kind, receiver, func_name) {
      for (var n=0;n<this.hrecv.length;++n) {
         var entry = this.hrecv[n];
         if (entry.obj === receiver) {
            entry[kind] = func_name;
            return;
         }
      }
      var entry = { obj: receiver };
      entry[kind] = func_name;
      this.hrecv.push(entry);
   }

   /** Register object with function, which is called when manager structure is updated */
   EveManager.prototype.RegisterUpdate = function(receiver, func_name) {
      this.RegisterReceiver("update", receiver, func_name);
   }

   /** Register object with function, which is called when manager structure is updated */
   EveManager.prototype.RegisterElementUpdate = function(receiver, func_name) {
      this.RegisterReceiver("elem_update", receiver, func_name);
   }

   /** Invoke specified receiver functions on all registered receivers */

   EveManager.prototype.InvokeReceivers = function(kind, sender, timeout, receiver_arg, receiver_arg2) {
      var tname = kind + "_timer";
      if (this[tname]) {
         clearTimeout(this[tname]);
         delete this[tname];
      }

      if (timeout) {
         this[tname] = setTimeout(this.InvokeReceivers.bind(this, kind, sender, 0, receiver_arg, receiver_arg2), timeout);
      } else {
         for (var n=0; n<this.hrecv.length; ++n) {
            var el = this.hrecv[n];
            if ((el.obj !== sender) && el[kind])
               el.obj[el[kind]](receiver_arg, receiver_arg2);
         }
      }
   }


   /** Invoke Update on all dependent views.
    * If timeout configured, actual execution will be postponed on given time interval */

   EveManager.prototype.ProcessUpdate = function(timeout) {
      this.InvokeReceivers("update", null, timeout, this);
   }

   EveManager.prototype.Unregister = function(receiver) {
      for (var n=0;n<this.hrecv.length;++n)
         if (this.hrecv[n].obj === receiver)
            this.hrecv.splice(n, 1);
   }

   // mark object and all its parents as modified
   EveManager.prototype.MarkSceneRrecreate = function(id) {
      while (id) {
         var elem = this.GetElement(id);
         if (!elem) return;
         if (elem.$receivers) elem.$modified = true; // mark only elements which have receivers
         id = elem.fMotherId;
      }
   }

   EveManager.prototype.ProcessSceneCreate = function(sceneid) {
      var elem = this.GetElement(sceneid);
      if (!elem || !elem.$modified) return;

      this.callSceneReceivers(elem, "onSceneCreate", sceneid);

      delete elem.$modified;
   }

   EveManager.prototype.ImportSceneJson = function(arr)
   {
      this.last_json = null;
      // console.log("JSON", arr[0]);

      // remember commands in manager
      if (arr[0].commands && !this.commands)
         this.commands = arr[0].commands;

      if (arr[0].fTotalBinarySize)
         this.last_json = arr;

      for (var n = 1; n < arr.length; ++n)
      {
         var elem = arr[n];

         var obj = this.map[elem.fElementId];

         if ( ! obj)
         {
            // element did not exist up to now
            var parent = null;
            if (elem.fMotherId !== 0) {
               parent = this.map[elem.fMotherId];
            } else {
               parent = this;
            }
            if (!parent) {
               console.error('Parent object ' + elem.fMotherId + ' does not exists - why?');
               return;
            }

            if (parent.childs === undefined)
               parent.childs = [];

            parent.childs.push(elem);

            obj = this.map[elem.fElementId] = elem;
         }

         this.MarkSceneRrecreate(elem.fElementId);
      }

      if (arr[0].fTotalBinarySize == 0) {
         console.log("scenemodified ", this.map[arr[0].fSceneId])
         this.ProcessSceneCreate(arr[0].fSceneId);
      }

      this.ProcessUpdate(300);
   }

   EveManager.prototype.ImportSceneChangeJson = function(msg) {
      var arr = msg.arr;
      this.last_json = null;
      this.scene_changes = msg;

      var scene = this.GetElement(msg.header.fSceneId);

      // notify scenes for beginning of changes and
      // notify for element removal
      var removedIds = msg.header["removedElements"];

      // do we need this?
      this.callSceneReceivers(scene, "beginChanges");

      for (var r = 0; r < removedIds.length; ++r)
         this.callSceneReceivers(scene, "elementRemoved", removedIds[r]);

      // wait for binary if needed
      if (msg.header.fTotalBinarySize)
      {
          this.last_json = [1];
          for (var i = 0; i < arr.length; ++i)
              this.last_json.push(arr[i]);

      } else {
         this.CompleteSceneChanges();
      }
   }

   //______________________________________________________________________________


   EveManager.prototype.CompleteSceneChanges = function()
   {
      if (!this.scene_changes) return;

      var arr = this.scene_changes.arr;
      var header = this.scene_changes.header;
      var scene = this.GetElement(header.fSceneId);
      var nModified = header["numRepresentationChanged"];

      this.scene_changes = null;

      for (var n=0; n<arr.length; ++n)
      {
         var em = arr[n];

         // update existing
         if (n < nModified )
         {
            var obj = this.map[em.fElementId];
            var tag = "changeBit";
            if (em.changeBit & this.EChangeBits.kCBVisibility)
            {
               if (obj.fRnrSelf != em.fRnrSelf) {
                  obj.fRnrSelf = em.fRnrSelf;
                  tag = "visibilityChanged";
               }
               if (obj.fRnrChildren != em.fRnrChildren) {
                  obj.fRnrChildren = em.fRnrChildren;
                  tag = "visibilityChildrenChanged";
               }
            }

            if (em.changeBit & this.EChangeBits.kCBColorSelection) {
               delete em.render_data;
               JSROOT.extend(obj, em);
               tag = "colorChanged";
            }

            if (em.changeBit & this.EChangeBits.kCBObjProps) {
               delete obj.render_data;
               jQuery.extend(obj, em);
               tag = "replaceElement";
            }

            // rename updateGED to checkGED???
            em.tag = tag;
            this.callSceneReceivers(scene, "sceneElementChange", em);
         }
         else
         {
            // create new
            this.map[em.fElementId] = em;
            var parent = this.map[em.fMotherId];
            if (!parent.childs)
               parent.childs = [];

            parent.childs.push(em);
            em.tag = "elementAdded";
            this.callSceneReceivers(scene, "sceneElementChange", em);
         }
         this.InvokeReceivers("elem_update", null, 0, em.fElementId);
      }


      var treeRebuild = header.removedElements.length || (arr.length != nModified );
      this.callSceneReceivers(scene, "endChanges", treeRebuild);
   },

   EveManager.prototype.DeleteChildsOf = function(elem) {
      if (!elem || !elem.childs) return;
      for (var n=0;n<elem.childs.length;++n) {
         var sub = elem.childs[n];
         this.DeleteChildsOf(sub);
         var id = sub.fElementId;
         if ((id !== undefined) && this.map[id])
            delete this.map[id];
      }
      delete elem.childs;
   }

   EveManager.prototype.DestroyElements = function(arr) {
      var ids = arr[0].element_ids;
      if (!ids) return;

      for (var n=0;n<ids.length;++n) {
         var element = this.GetElement(ids[n]);
         if (!element) {
            console.log("try to delete non-existing element with id", ids[n]);
            continue;
         }

         this.DeleteChildsOf(element);
         element.$modified = true;
         this.ProcessSceneCreate(ids[n]);
      }

      // this.ignore_all = true;

      this.ProcessUpdate(300);
   }

   EveManager.prototype.FindViewers = function(chlds) {
      if (chlds === undefined) chlds = this.childs;

      for (var k=0;k<chlds.length;++k) {
         if (!chlds[k].childs) continue;
         if (chlds[k]._typename == "ROOT::Experimental::REveViewerList") return chlds[k].childs;
         var res = this.FindViewers(chlds[k].childs);
         if (res) return res;
      }
   }

   EveManager.prototype.ImportSceneBinary = function(rawdata, offset) {

      if (!this.last_json || !rawdata || !rawdata.byteLength) return;

      var arr = this.last_json;
      this.last_json = null;

      var lastoff = offset;

      for (var n=1; n<arr.length;++n) {
         var elem = arr[n];

         if (!elem.render_data) continue;

         var rd = elem.render_data,
             off = offset + rd.rnr_offset,
             obj = this.GetElement(elem.fElementId);

         if (off !== lastoff)
            console.error('Element ' + elem.fName + ' offset mismatch ' + off + ' != ' + lastoff);

         if (rd.trans_size) {
            rd.matrix = new Float32Array(rawdata, off, rd.trans_size);
            off += rd.trans_size*4;
         }
         if (rd.vert_size) {
            rd.vtxBuff = new Float32Array(rawdata, off, rd.vert_size);
            off += rd.vert_size*4;
         }

         if (rd.norm_size) {
            rd.nrmBuff = new Float32Array(rawdata, off, rd.norm_size);
            off += rd.norm_size*4;
         }

         if (rd.index_size) {
            rd.idxBuff = new Uint32Array(rawdata, off, rd.index_size);
            off += rd.index_size*4;
         }

         lastoff = off;
      }

      if (lastoff !== rawdata.byteLength)
         console.error('Raw data decoding error - length mismatch', lastoff, rawdata.byteLength);

      if (this.scene_changes)
         this.CompleteSceneChanges();
      else
         this.ProcessSceneCreate(arr[0].fSceneId);
   }

   JSROOT.EVE.EveManager = EveManager;

   return JSROOT;

}));
