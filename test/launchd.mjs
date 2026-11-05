import assert from 'assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getBackend } from '../lib/backend.mjs'
import { compileLaunchdSchedule, MAX_CALENDAR_INTERVALS } from '../lib/launchd-schedule.mjs'
import { buildLaunchdPlist, getLaunchdDir, getLaunchdDomain, LABEL_PREFIX, launchdConfig, readLaunchdJobs, runLaunchctl } from '../lib/launchd.mjs'
import { add, list, print, remove, doctor, findEntryIssues } from '../lib/commands.mjs'
import { buildBlock, makeId } from '../lib/entry.mjs'
import { withLaunchdSandbox } from './helpers/launchd-sandbox.mjs'

export async function runLaunchdTests({ test, testAsync, captureLogs, withPatchedVersion }) {
  test('scheduler: macOS 기본 launchd·다른 환경 기본 cron 및 명시 선택·잘못된 값 검증', () => {
    assert.equal(getBackend('darwin', {}), 'launchd'); assert.equal(getBackend('linux', {}), 'cron')
    assert.equal(getBackend('darwin', { CRONLY_BACKEND: 'cron' }), 'cron')
    assert.throws(() => getBackend('linux', { CRONLY_BACKEND: 'invalid' }), /Unsupported scheduler/)
    assert.equal(getLaunchdDir({}), join(homedir(), 'Library', 'LaunchAgents'))
  })
  test('launchd 일정: 간편 스케줄과 모든 alias를 네이티브 달력으로 변환', () => {
    const samples = {
      '0 8 * * *': [{ Minute: 0, Hour: 8 }], '0 9 * * 1-5': [1,2,3,4,5].map(Weekday=>({Minute:0,Hour:9,Weekday})),
      '0 0 * * 7': [{Minute:0,Hour:0,Weekday:0}], '* * * * *': [{}],
      '@yearly': [{Minute:0,Hour:0,Day:1,Month:1}], '@annually': [{Minute:0,Hour:0,Day:1,Month:1}],
      '@monthly': [{Minute:0,Hour:0,Day:1}], '@weekly': [{Minute:0,Hour:0,Weekday:0}],
      '@daily': [{Minute:0,Hour:0}], '@hourly': [{Minute:0}],
    }
    for(const [schedule,calendar] of Object.entries(samples)) assert.deepEqual(compileLaunchdSchedule(schedule),{calendar})
    assert.deepEqual(compileLaunchdSchedule('@reboot'),{runAtLoad:true})
    assert.equal(compileLaunchdSchedule('0-30/15 0,12 * * *').calendar.length,6)
    assert.equal(compileLaunchdSchedule('*/15 * * * *').calendar.length,4)
    assert.equal(compileLaunchdSchedule('* * * * 0,7').calendar.length,1)
  })
  test('launchd 일정: 날짜·요일 OR와 전체 범위 의미를 보존하고 부정확한 AND는 거부', () => {
    assert.deepEqual(compileLaunchdSchedule('0 8 1 * 1').calendar,[{Minute:0,Hour:8,Day:1},{Minute:0,Hour:8,Weekday:1}])
    assert.deepEqual(compileLaunchdSchedule('0 8 1-31 * 1').calendar,[{Minute:0,Hour:8}])
    assert.deepEqual(compileLaunchdSchedule('0 8 1 * 0-7').calendar,[{Minute:0,Hour:8}])
    assert.throws(()=>compileLaunchdSchedule('0 0 */2 * 1'),/cannot be represented/)
    assert.throws(()=>compileLaunchdSchedule('0 0 1 * */2'),/cannot be represented/)
    assert.throws(()=>compileLaunchdSchedule('not a cron'),/Invalid cron/)
    assert.throws(()=>compileLaunchdSchedule('*/2 */2 1-15 */2 *'),new RegExp(String(MAX_CALENDAR_INTERVALS)))
    assert.throws(()=>compileLaunchdSchedule('*/2 */2 1 */2 1'),new RegExp(String(MAX_CALENDAR_INTERVALS)))
  })
  await testAsync('launchd CLI: 등록·갱신·조회·출력·진단·삭제와 셸 없는 실행 인자', async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script("a &<>'\"%\\job.mjs")
      assert.equal(ctx.cli(['list']).status,0)
      assert.match(ctx.cli(['print']).stdout,/No managed launchd/)
      let result=ctx.cli(['add',file,'--daily','08:00']);assert.equal(result.status,0,result.stderr)
      const [job]=readLaunchdJobs();assert.equal(job.path,file)
      const config=launchdConfig(job);assert.deepEqual(config.ProgramArguments,[process.execPath,file]);assert.equal(config.RunAtLoad,false)
      assert.equal(config.WorkingDirectory,ctx.dir);assert.equal(config.StandardErrorPath,job.logPath)
      assert.ok(job.raw.includes('&amp;')&&job.raw.includes('&lt;')&&job.raw.includes('&gt;')&&job.raw.includes('&quot;')&&job.raw.includes('&apos;'))
      assert.match(ctx.cli(['list']).stdout,/launchd/);assert.match(ctx.cli(['print']).stdout,/<plist/)
      result=ctx.cli(['add',file,'--reboot','--runtime','exec']);assert.equal(result.status,0,result.stderr)
      assert.deepEqual(launchdConfig(readLaunchdJobs()[0]).ProgramArguments,[file])
      assert.equal(launchdConfig(readLaunchdJobs()[0]).RunAtLoad,true)
      assert.equal(ctx.cli(['doctor']).status,0)
      assert.equal(ctx.cli(['remove','--id',job.id]).status,0)
      assert.deepEqual(ctx.state(),{});assert.deepEqual(readLaunchdJobs(),[])
      assert.equal(ctx.cli(['add',file,'--every-minutes','1']).status,0)
      assert.equal(ctx.cli(['remove',file]).status,0)
      assert.ok(!ctx.calls().includes('crontab writes'))
    })
  })
  await testAsync('launchd: 잘못된 입력과 실행 권한을 등록 전에 거부',async()=>{
    await withLaunchdSandbox(async ctx=>{
      await assert.rejects(()=>add(undefined,{schedule:'@daily'}),/specify a file/)
      await assert.rejects(()=>add('file',{}),/No schedule/)
      await assert.rejects(()=>add(join(ctx.dir,'missing'),{schedule:'@daily'}),/File not found/)
      await assert.rejects(()=>add(ctx.dir,{schedule:'@daily'}),/Not a file/)
      await assert.rejects(()=>add(ctx.script('unknown'),{schedule:'@daily'}),/Cannot infer/)
      await assert.rejects(()=>add(ctx.script('notexec','',0o644),{schedule:'@daily',runtime:'exec'}),/Not executable/)
      await assert.rejects(()=>add(ctx.script('line\njob.mjs'),{schedule:'@daily'}),/newline/)
      assert.equal(ctx.calls(),'')
      await assert.rejects(()=>remove(undefined,{}),/specify a file/)
      await assert.rejects(()=>remove(undefined,{id:'missing'}),/Entry not found for id/)
      await assert.rejects(()=>remove(ctx.script(),{}),/Entry not found for file/)
    })
  })
  await testAsync('launchd: 심볼릭 링크·중복 파일 경로를 대체하고 이전 plist를 제거',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();const alias=join(ctx.dir,'alias.mjs');symlinkSync(file,alias)
      await captureLogs(()=>add(file,{schedule:'@daily'}))
      const old=readLaunchdJobs()[0]
      await captureLogs(()=>add(alias,{schedule:'@hourly'}))
      const jobs=readLaunchdJobs();assert.equal(jobs.length,1);assert.equal(jobs[0].path,alias)
      assert.equal(existsSync(old.plistPath),false);assert.equal(ctx.state()[old.label],undefined)
      await captureLogs(()=>remove(file,{}));assert.deepEqual(readLaunchdJobs(),[])
    })
  })
  await testAsync('launchd: 기존 cron 작업을 숨기거나 중복 등록하지 않음',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();process.env.LAUNCHD_TEST_LEGACY=buildBlock({schedule:'@daily',absolutePath:file,runtime:'node'})
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/Still registered in cron/)
      const listing=await captureLogs(()=>list());assert.ok(listing.logs.some(l=>l.includes('Legacy cron jobs: 1')))
      const printing=await captureLogs(()=>print());assert.ok(printing.logs.some(l=>l.includes('Legacy cron jobs: 1')))
      assert.equal((await captureLogs(()=>doctor())).result,false)
      assert.deepEqual(ctx.state(),{})
    })
  })
  await testAsync('스케줄러 전환: launchd 작업을 cron에 중복 등록하지 않음',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();await captureLogs(()=>add(file,{schedule:'@daily'}))
      process.env.CRONLY_BACKEND='cron'
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/Already registered in launchd/)
      assert.equal(Object.keys(ctx.state()).length,1)
    })
  })
  await testAsync('launchd: 손상된 메타데이터·plist를 안전하게 거부하고 다른 앱 파일은 무시',async()=>{
    await withLaunchdSandbox(async ctx=>{
      assert.deepEqual(readLaunchdJobs(),[]);mkdirSync(ctx.agents)
      writeFileSync(join(ctx.agents,'other.plist'),'unrelated');assert.deepEqual(readLaunchdJobs(),[])
      const file=ctx.script();await captureLogs(()=>add(file,{schedule:'@daily'}));const job=readLaunchdJobs()[0]
      const variants=[job.raw.replace(/<!-- cronly:[^ ]+ -->/,'<!-- invalid -->'),job.raw.replace(/cronly:[^ ]+ /,'cronly:eA== '),job.raw+'\n']
      for(const raw of variants){writeFileSync(job.plistPath,raw);assert.throws(()=>readLaunchdJobs(),/Invalid Cronly/)}
      for(const mutation of [{runtimePath:1},{id:'wrong'},{backend:'cron'},{path:'relative.mjs'}]){
        const data={...job,...mutation};const raw=job.raw.replace(/<!-- cronly:[^ ]+ -->/,`<!-- cronly:${Buffer.from(JSON.stringify(data)).toString('base64')} -->`)
        writeFileSync(job.plistPath,raw);assert.throws(()=>readLaunchdJobs(),/Invalid Cronly/)
      }
      writeFileSync(job.plistPath,job.raw);writeFileSync(join(ctx.agents,`${LABEL_PREFIX}wrong.plist`),job.raw)
      assert.throws(()=>readLaunchdJobs(),/Invalid Cronly/)
      rmSync(join(ctx.agents,`${LABEL_PREFIX}wrong.plist`))
      assert.equal(readLaunchdJobs().length,1)
    })
  })
  await testAsync('launchd: bootstrap 실패 시 새 작업을 제거하고 기존 작업을 복원',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();process.env.LAUNCHD_TEST_FAIL='bootstrap'
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/operation denied/)
      assert.deepEqual(readLaunchdJobs(),[])
      process.env.LAUNCHD_TEST_FAIL='';await captureLogs(()=>add(file,{schedule:'@daily'}));const original=readLaunchdJobs()[0]
      process.env.LAUNCHD_TEST_FAIL_ONCE='bootstrap'
      await assert.rejects(()=>add(file,{schedule:'@hourly'}),/temporary failure/)
      assert.equal(readLaunchdJobs()[0].raw,original.raw);assert.equal(ctx.state()[original.label].schedule,'@daily')
    })
  })
  await testAsync('launchd: 부분 등록·복원 실패와 로드된 고아 작업을 보고',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();process.env.LAUNCHD_TEST_FAIL_AFTER='1'
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/failed after loading/)
      assert.deepEqual(ctx.state(),{});assert.deepEqual(readLaunchdJobs(),[])
      process.env.LAUNCHD_TEST_FAIL_AFTER='';await captureLogs(()=>add(file,{schedule:'@daily'}))
      process.env.LAUNCHD_TEST_FAIL='bootstrap'
      await assert.rejects(()=>add(file,{schedule:'@hourly'}),/could not restore/)
      assert.equal(readLaunchdJobs()[0].schedule,'@daily')
      process.env.LAUNCHD_TEST_FAIL='';ctx.setState({[LABEL_PREFIX+makeId(file)]:{}});rmSync(readLaunchdJobs()[0].plistPath)
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/without a matching/)
      assert.ok(ctx.state()[LABEL_PREFIX+makeId(file)])
    })
  })
  await testAsync('launchd: bootout 실패 시 기존 작업·파일을 보존하고 미로드 작업도 삭제 가능',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();await captureLogs(()=>add(file,{schedule:'@daily'}));const job=readLaunchdJobs()[0]
      process.env.LAUNCHD_TEST_FAIL='bootout';await assert.rejects(()=>remove(file,{}),/operation denied/)
      assert.equal(readLaunchdJobs()[0].raw,job.raw);assert.ok(ctx.state()[job.label])
      process.env.LAUNCHD_TEST_FAIL='';ctx.setState({});await captureLogs(()=>remove(file,{}));assert.deepEqual(readLaunchdJobs(),[])
    })
  })
  await testAsync('launchd doctor: 세션·읽기 오류와 실행 실패·권한·미로드 상태를 진단',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();await captureLogs(()=>add(file,{schedule:'@daily'}));const job=readLaunchdJobs()[0]
      assert.equal((await captureLogs(()=>doctor())).result,true)
      process.env.LAUNCHD_TEST_EXIT='7';let report=await captureLogs(()=>doctor());assert.equal(report.result,false);assert.ok(report.logs.some(l=>l.includes('exit 7')))
      process.env.LAUNCHD_TEST_EXIT='';ctx.setState({});report=await captureLogs(()=>doctor());assert.equal(report.result,false);assert.ok(report.logs.some(l=>l.includes('not loaded')))
      chmodSync(file,0o000);assert.equal((await captureLogs(()=>doctor())).result,false);chmodSync(file,0o755)
      process.env.LAUNCHD_TEST_FAIL='print';assert.equal((await captureLogs(()=>doctor())).result,false)
      process.env.LAUNCHD_TEST_FAIL='';process.env.LAUNCHD_TEST_READ_FAIL='1';assert.equal((await captureLogs(()=>doctor())).result,false)
      process.env.LAUNCHD_TEST_READ_FAIL='';await withPatchedVersion('v14.7.0',async()=>assert.equal((await captureLogs(()=>doctor())).result,false))
      assert.equal(findEntryIssues({...job,runtime:'exec',runtimePath:''}).length,0)
    })
  })
  await testAsync('launchd: 동시 등록이 각 작업을 보존하고 print 오류를 등록 성공으로 취급하지 않음',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const a=ctx.script('a.mjs'),b=ctx.script('b.mjs');process.env.LAUNCHD_TEST_DELAY='100'
      const results=await Promise.all([ctx.cliAsync(['add',a,'--daily','08:00']),ctx.cliAsync(['add',b,'--daily','09:00'])])
      for(const result of results)assert.equal(result.status,0,result.stderr)
      assert.equal(readLaunchdJobs().length,2);assert.equal(Object.keys(ctx.state()).length,2)
      process.env.LAUNCHD_TEST_FAIL='print';await assert.rejects(()=>add(a,{schedule:'@daily'}),/operation denied/)
    })
  })
  await testAsync('launchd: plist 교체 실패 시 임시 파일과 잘못된 등록을 남기지 않음',async()=>{
    await withLaunchdSandbox(async ctx=>{
      const file=ctx.script();process.env.LAUNCHD_TEST_BLOCK_TARGET='1'
      await assert.rejects(()=>add(file,{schedule:'@daily'}),/EISDIR|EEXIST|ENOTEMPTY/)
      assert.equal(readdirSync(ctx.agents).some(name=>name.endsWith('.tmp')),false)
      assert.deepEqual(ctx.state(),{})
    })
  })
  await testAsync('launchd 명령 누락: 자식 프로세스 생성 오류를 정상 실패로 반환',async()=>{
    await withLaunchdSandbox(async()=>{
      const path=process.env.PATH;process.env.PATH='/no-launchctl'
      try{const r=await runLaunchctl(['print',getLaunchdDomain()],()=>assert.fail('unspawned process tracked'));assert.equal(r.ok,false);assert.match(r.detail,/ENOENT/)}finally{process.env.PATH=path}
    })
  })
}
