import React from 'react';
import {metricText,METRICS} from './masterChartData.js';
const colors=['#2E5E4E','#8CC3AD','#C0D4C8','#A5372B','#B2ABA0','#597879'];
const short=s=>String(s).length>22?String(s).slice(0,21)+'…':String(s);
export default function MasterVisual({title,type='bar',data=[],metric='revenue',onSelect,secondaryLabel='Refunded units'}){
  const rows=data.filter(d=>Number.isFinite(d.value)&&(type!=='scatter'||Number.isFinite(d.y)));
  const usable=rows.length>0&&(!['donut','treemap'].includes(type)||rows.some(d=>d.value>0));
  const act=d=>onSelect?.(d);
  const interactive=d=>({role:onSelect?'button':undefined,tabIndex:onSelect?0:undefined,onClick:()=>act(d),onKeyDown:e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();act(d);}},'aria-label':`${d.label}: ${metricText(d.value,metric)}`});
  const width=800,height=Math.max(270,['bar','comparison','stacked','waterfall','donut'].includes(type)?rows.length*37+50:type==='heatmap'?Math.ceil(rows.length/10)*55+50:290),left=175,right=690,top=25,bottom=height-45;
  const min=Math.min(0,...rows.map(d=>d.value),...rows.map(d=>Number.isFinite(d.second)?d.second:0),...rows.flatMap(d=>[d.start||0,d.end||0]));
  const max=Math.max(1,...rows.map(d=>type==='stacked'?Math.max(0,d.value)+Math.max(0,d.second||0):d.value),...rows.map(d=>d.second||0),...rows.flatMap(d=>[d.start||0,d.end||0]));
  const x=v=>left+(v-min)/(max-min)*(right-left),zero=x(0);
  const y=v=>bottom-(v-min)/(max-min)*(bottom-top);
  const px=i=>70+(rows.length===1?330:i/(rows.length-1)*660);
  const total=rows.reduce((s,d)=>s+Math.max(0,d.value),0);
  const tooltip=d=>[d.label,metricText(d.value,metric),Number.isFinite(d.second)?secondaryLabel+': '+metricText(d.second,metric):'',type==='donut'?((d.value/total)*100).toFixed(2)+'%':'',type==='scatter'?d.y.toFixed(2)+'% customer returns':''].filter(Boolean).join(' | ');
  let offset=0;
  return <article className="mc-panel mc-visual"><div className="mc-panel-title"><h3>{title}</h3><span>{type} · {METRICS[metric]?.unit==='money'?'₹':METRICS[metric]?.unit==='percent'?'%':metric==='orders'?'orders':'units'}</span></div>
    {!usable?<div className="mc-empty">Insufficient data</div>:<>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
      <title>{`${title}. ${METRIC_NOTE(type)}`}</title>
      {(type==='bar'||type==='comparison'||type==='stacked'||type==='waterfall')&&<>
        <line x1={zero} x2={zero} y1={10} y2={bottom+10} stroke="#E4E4DF"/>
        {rows.map((d,i)=>{const yy=top+i*(bottom-top)/Math.max(rows.length,1),v=d.value;return <g key={d.key||i} {...interactive(d)}><title>{tooltip(d)}</title>
          <text x={left-10} y={yy+15} textAnchor="end">{short(d.label)}</text>
          <rect x={type==='waterfall'?Math.min(x(d.start),x(d.end)):Math.min(zero,x(v))} y={yy} width={Math.max(1,type==='waterfall'?Math.abs(x(d.end)-x(d.start)):Math.abs(x(v)-zero))} height={type==='comparison'?10:22} rx="3" fill={d.value<0?'#A5372B':colors[i%3]}/>
          {type==='comparison'&&Number.isFinite(d.second)&&<rect x={Math.min(zero,x(d.second))} y={yy+13} width={Math.max(1,Math.abs(x(d.second)-zero))} height="10" fill="#A5372B" rx="2"/>}
          {type==='stacked'&&d.second>0&&<rect x={x(Math.max(0,v))} y={yy} width={x(Math.max(0,v)+d.second)-x(Math.max(0,v))} height="22" fill="#A5372B"/>}
          <text x={right+8} y={yy+15} textAnchor="start">{metricText(d.value,metric)}</text>
        </g>;})}
      </>}
      {(type==='line'||type==='area')&&<>
        {[min,(min+max)/2,max].map(v=><g key={v}><line x1="65" x2="740" y1={y(v)} y2={y(v)} stroke="#E4E4DF"/><text x="60" y={y(v)-5} textAnchor="end">{metricText(v,metric)}</text></g>)}
        {type==='area'&&<path d={`M ${px(0)} ${y(0)} ${rows.map((d,i)=>`L ${px(i)} ${y(d.value)}`).join(' ')} L ${px(rows.length-1)} ${y(0)} Z`} fill="#E8EFEB"/>}
        <polyline points={rows.map((d,i)=>`${px(i)},${y(d.value)}`).join(' ')} fill="none" stroke="#2E5E4E" strokeWidth="3"/>
        {rows.map((d,i)=><g key={i} {...interactive(d)}><title>{`${d.label}: ${metricText(d.value,metric)}`}</title><circle cx={px(i)} cy={y(d.value)} r="6" fill="#2E5E4E"/>{(i===0||i===rows.length-1||rows.length<9)&&<text x={px(i)} y={bottom+26} textAnchor="middle">{d.label}</text>}</g>)}
      </>}
      {type==='donut'&&total>0&&<>
        {rows.filter(d=>d.value>0).map((d,i)=>{const length=d.value/total*565.49,off=offset;offset+=length;return <g key={i} {...interactive(d)}><title>{tooltip(d)}</title><circle cx="230" cy="140" r="90" fill="none" stroke={colors[i%colors.length]} strokeWidth="38" strokeDasharray={`${length} ${565.49-length}`} strokeDashoffset={-off} transform="rotate(-90 230 140)"/></g>;})}
        <text x="230" y="135" textAnchor="middle">Gross contribution</text><text x="230" y="160" textAnchor="middle">{metricText(total,metric)}</text>
        {rows.map((d,i)=><g key={i} {...interactive(d)}><rect x="420" y={35+i*30} width="12" height="12" fill={colors[i%colors.length]}/><text x="442" y={46+i*30}>{short(d.label)} · {metricText(d.value,metric)}</text></g>)}
      </>}
      {type==='heatmap'&&rows.map((d,i)=>{const col=i%10,row=Math.floor(i/10),opacity=.15+.85*Math.abs(d.value)/Math.max(Math.abs(max),Math.abs(min));return <g key={i} {...interactive(d)}><title>{`${d.label}: ${metricText(d.value,metric)}`}</title><rect x={20+col*77} y={20+row*55} width="72" height="48" rx="4" fill={d.value<0?'#A5372B':'#2E5E4E'} opacity={opacity}/><text x={56+col*77} y={40+row*55} textAnchor="middle" fill={opacity>.6?'white':'#121212'}>{d.label.slice(-5)}</text></g>;})}
      {type==='treemap'&&total>0&&rows.filter(d=>d.value>0).map((d,i)=>{const w=d.value/total*760,start=offset;offset+=w;return <g key={i} {...interactive(d)}><title>{`${d.label}: ${metricText(d.value,metric)}`}</title><rect x={20+start} y="25" width={Math.max(0,w-3)} height="220" rx="5" fill={colors[i%3]}/>{w>85&&<><text x={25+start} y="60" fill={i%3===0?'white':'#121212'}>{short(d.label).slice(0,Math.floor(w/7))}</text><text x={25+start} y="85" fill={i%3===0?'white':'#121212'}>{metricText(d.value,metric)}</text></>}</g>;})}
      {type==='scatter'&&<>
        <line x1="65" x2="740" y1={bottom} y2={bottom} stroke="#B2ABA0"/><line x1="65" x2="65" y1="20" y2={bottom} stroke="#B2ABA0"/>
        <text x="400" y={height-5} textAnchor="middle">Gross sold units →</text><text x="70" y="15">Customer return % ↑</text>
        {rows.filter(d=>Number.isFinite(d.y)).map((d,i)=><g key={i} {...interactive(d)}><title>{tooltip(d)}</title><circle cx={70+d.value/Math.max(1,...rows.map(r=>r.value))*650} cy={bottom-d.y/Math.max(1,...rows.map(r=>r.y||0))*(bottom-30)} r="8" fill={colors[i%3]} stroke="white"/><text x={82+d.value/Math.max(1,...rows.map(r=>r.value))*650} y={bottom-d.y/Math.max(1,...rows.map(r=>r.y||0))*(bottom-30)}>{short(d.label)}</text></g>)}
      </>}
    </svg>
    {(type==='comparison'||type==='stacked')&&<p className="mc-caption"><span className="mc-legend-dot"/> {type==='stacked'?'Net units':'Primary'} <span className="mc-legend-dot red"/> {secondaryLabel}</p>}
    <details className="mc-chart-data"><summary>View chart data / drill down</summary><ul>{rows.map((d,i)=><li key={i}><button type="button" onClick={()=>act(d)}>{d.label}</button><span>{metricText(d.value,metric)}{Number.isFinite(d.second)?` / ${metricText(d.second,metric)}`:''}</span></li>)}</ul></details>
    </>}
  </article>;
}
const METRIC_NOTE=type=>type==='treemap'?'Area represents positive gross revenue.':type==='heatmap'?'Darker cells represent larger values.':'Use chart points or View chart data for supporting records.';
