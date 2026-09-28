const crypto=require('node:crypto');
class ActivityStore {
  constructor(database){this.database=database;}
  list(){const rows=this.database.getSetting('activity_messages',[]);if(rows.length>8)this.database.setSetting('activity_messages',rows.slice(0,8));return rows.slice(0,8);}
  clear(){this.database.setSetting('activity_messages',[]);return [];}
  unread(){return this.list().filter(item=>!item.read).length;}
  add({key,kind,title,body}){
    const rows=this.list();
    if(key&&rows.some(item=>item.key===key))return null;
    const item={id:crypto.randomUUID(),key,kind,title,body,read:false,createdAt:new Date().toISOString()};
    this.database.setSetting('activity_messages',[item,...rows].slice(0,8));return item;
  }
  read(id){this.database.setSetting('activity_messages',this.list().map(item=>id==='all'||item.id===id?{...item,read:true}:item));return this.list();}
}
module.exports={ActivityStore};
