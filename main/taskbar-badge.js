const zlib=require('node:zlib');
const digits={0:['111','101','101','101','111'],1:['010','110','010','010','111'],2:['111','001','111','100','111'],3:['111','001','111','001','111'],4:['101','101','111','001','001'],5:['111','100','111','001','111'],6:['111','100','111','101','111'],7:['111','001','010','010','010'],8:['111','101','111','101','111'],9:['111','101','111','001','111'],'+':['000','010','111','010','000']};
function crc(bytes){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([length,type,data,checksum]);}
function badgePng(count,dark=false){
  if(count<=0)return null;
  const text=count>99?'99+':String(count),size=64,scale=text.length===3?4:6,width=(text.length*4-1)*scale;
  const raw=Buffer.alloc((size*4+1)*size);
  const set=(x,y,r,g,b,a)=>{const offset=y*(size*4+1)+1+x*4;raw.set([r,g,b,a],offset);};
  const fill=dark?[235,233,224]:[39,54,48],rim=dark?[133,177,159]:[119,164,145],ink=dark?[37,52,45]:[248,247,239];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const distance=Math.hypot(x-31.5,y-31.5),coverage=Math.max(0,Math.min(1,31.5-distance));
    const color=distance>28.5?rim:fill;set(x,y,...color,Math.round(coverage*255));
  }
  for(let n=0;n<text.length;n++)for(let y=0;y<5;y++)for(let x=0;x<3;x++)if(digits[text[n]][y][x]==='1')for(let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++)set(Math.floor((size-width)/2)+n*4*scale+x*scale+dx,Math.floor((size-5*scale)/2)+y*scale+dy,...ink,255);
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
module.exports={badgePng};
