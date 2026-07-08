import { createRoot } from 'react-dom/client'
import { BodyModel, type RegionView } from './features/cycle/BodyModel'
import './index.css'
const R = ['chest','back','shoulders','biceps','triceps','forearms','abs','glutes','quads','hamstrings','calves','adductors','genitals']
const lit: Record<string,RegionView> = {}; R.forEach(k=>lit[k]={sets:6,items:[{name:'x',sets:6,day:'A'}]})
createRoot(document.getElementById('r')!).render(<div style={{display:'flex'}}>
  <BodyModel activity={lit} lang="zh" adult /><BodyModel activity={{}} lang="zh" adult />
</div>)
