// Diagnostics only. Weak associations keep timing metadata out of sale rows/data.
export const scanRowPerf = new WeakMap();
let nextRun = 0;
export const newScanRunId = () => `scan-${Date.now()}-${++nextRun}`;
export function createScanPerf(runId, file = '(batch)', index = null) {
  const started = performance.now();
  const state = { parserSource:'PENDING', ollamaCalled:false, imageRendered:false, imageRenderStarted:false };
  const sources = new Set();
  const log = (stage, details = {}) => {
    const now = performance.now();
    console.info('[SCAN_PERF] ' + JSON.stringify({
      version:'scan-perf-v1', runId, file, index, timestamp:new Date().toISOString(),
      performanceMs:Number(now.toFixed(3)), elapsedMs:Number((now-started).toFixed(3)),
      stage, ...state, ...details
    }));
  };
  const begin = (stage, details = {}) => {
    const start = performance.now(); log(`${stage}_start`,details);
    return (extra = {}) => log(`${stage}_end`,{...details,durationMs:Number((performance.now()-start).toFixed(3)),...extra});
  };
  return {
    log, begin, state,
    source(source) { sources.add(source); state.parserSource=sources.size === 1 ? source : 'MIXED'; },
    sync(stage,fn,details) {
      const end=begin(stage,details);
      try { const result=fn(); end(); return result; }
      catch(error) { end({error:error.message}); throw error; }
    },
    async async(stage,fn,details) {
      const end=begin(stage,details);
      try { const result=await fn(); end(); return result; }
      catch(error) { end({error:error.message}); throw error; }
    }
  };
}
