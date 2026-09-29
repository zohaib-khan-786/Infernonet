const srgb=c=>{const v=c/255;return v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4};
const lum=h=>{const n=parseInt(h.slice(1),16);return 0.2126*srgb((n>>16)&255)+0.7152*srgb((n>>8)&255)+0.0722*srgb(n&255)};
const R=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((p,q)=>q-p);return((x+0.05)/(y+0.05)).toFixed(2)};
const S={void:'#06111F',sunken:'#081525',field:'#0B1B2D',plate:'#10243A',bezel:'#030A14'};
const rows=[
 ['ink-primary','#F3F7FB'],['ink-secondary','#91A4B8'],['ink-tertiary','#778CA1'],
 ['ink-disabled','#5E7086'],['rule-hairline','#1C3854'],['rule-strong','#3870A7'],
];
for(const[n,v]of rows){
  console.log(n.padEnd(15)+v+'  '+Object.entries(S).map(([k,s])=>k+' '+R(v,s)).join('  '));
}
