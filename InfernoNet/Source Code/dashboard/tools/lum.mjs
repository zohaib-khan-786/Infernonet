const srgb=c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4};
const L=h=>{const n=parseInt(h.slice(1),16);return 0.2126*srgb((n>>16)&255)+0.7152*srgb((n>>8)&255)+0.0722*srgb(n&255)};
const inks={fresh:'#20C997','use-soon':'#F59E0B','check-food':'#F05252','sensor-fault':'#C7D1DA'};
const tints={fresh:'#0A2A22','use-soon':'#2E2109','check-food':'#2F1113','sensor-fault':'#1A2229'};
console.log('INKS');
const il=[];for(const[k,v]of Object.entries(inks)){const l=L(v);il.push([k,l]);console.log('  '+k.padEnd(13)+v+'  L '+l.toFixed(4))}
il.sort((a,b)=>a[1]-b[1]);let g=9;
for(let i=1;i<il.length;i++)g=Math.min(g,il[i][1]-il[i-1][1]);
console.log('  smallest gap: '+g.toFixed(4));
console.log('TINTS');
const tl=[];for(const[k,v]of Object.entries(tints)){const l=L(v);tl.push([k,l]);console.log('  '+k.padEnd(13)+v+'  L '+l.toFixed(4))}
tl.sort((a,b)=>a[1]-b[1]);console.log('  order: '+tl.map(x=>x[0]+' '+x[1].toFixed(4)).join(' < '));
