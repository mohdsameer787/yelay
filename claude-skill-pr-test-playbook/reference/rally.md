# Rally test cases from the browser (WSAPI)

Use only when the user allows the browser for this task. Work in the user's logged-in Rally tab
(open `https://rally1.rallydev.com/slm/webservice/v2.0/hierarchicalrequirement/<story-oid>?fetch=FormattedID`
so calls are same-origin). Never create accounts or type credentials.

## Rules learned the hard way

- **Small stateless calls.** The javascript tool times out at ~45 s and Chrome may replace a frozen tab,
  losing `window.*` state. Lookups: 25 names per call. Creates: 8–15 per call. Updates: ~20 per call.
  Re-define helpers if a call says `window.__X is not a function`.
- **Never trust a timed-out create.** It may have succeeded. Reconcile by exact name before retrying.
- **Names must be unique** across the whole story, including old TCs. A name equal to an older TC makes the
  name lookup return the old id. Rename the test case in code first (e.g. add the route or entity), then create.
- **Only ids at or above the first id of this round count as mine** (filter `x >= FIRST`), so old TCs are
  never reused.
- Other teams create TCs at the same time, so new ids are not contiguous. Record each result.
- Name format: `<case text> (<repo>)`, where `<case text>` is the test name after `[TCxxxx] `.
- Fields on create: `Name, Method: "Automated", Type: "Functional", WorkProduct: "/hierarchicalrequirement/<oid>",
  Project: "/project/<oid>", PreConditions, ValidationInput, ValidationExpectedResult, Objective`.
- New-TC Objective: `<story> <title>: <case text>. Test file: <path>`.
  Old TCs created earlier use `"<sub-story title> (<story> <title>): <Outcome>."` and
  Expected `"Outcome: <Outcome>. Asserted: <expected log>"`. When updating an old TC keep its layout:
  keep the Objective prefix up to `"): "`, replace only the outcome sentence.
- PreConditions come from the test layer. DTO tests under `handler/rest/dto` are
  unit tests, not route tests.
- ValidationInput / ValidationExpectedResult = the case's `input:` / `expected:` log lines (from `go test -json`).
  Dynamic case names (`"... "+itoa(v)+"..."`) are one TC: name it `(each value)` and write input/expected by hand.
- Results containing URLs or `?key=` are blocked by the tool. Strip `_ref` and query strings before returning text.
- Do not hard-delete TCs. Orphaned ids are listed for the user to close.

## Story and project ids

Read them once from the story page: `hierarchicalrequirement/<oid>` (WorkProduct) and its `Project._ref`.
US1122 = story 842840493621, project 825568745953 (DHAAM - ADMIN).

## Helpers (paste into the Rally tab, one call each)

Lookup by exact name, only ids ≥ FIRST:

```js
window.__f=async n=>{const q=await fetch("/slm/webservice/v2.0/testcase?query="+encodeURIComponent("(Name = \""+n.replace(/"/g,"\\\"")+" (REPO)\")")+"&fetch=FormattedID",{credentials:"include"}).then(r=>r.json());const m=q.QueryResult.Results.map(r=>+r.FormattedID.slice(2)).filter(x=>x>=FIRST);return m.length?m[0]:"-";};
window.__L=async B=>{const out=[];for(const [k,n] of B)out.push(k+":"+(await window.__f(n)));return out.join(",");};"ok"
```

Create (compact rows `[key, caseText, file, input, expected]`; precondition derived from the file):

```js
window.__P=f=>f.includes("integrationTesting")?"<DB precondition>":((f.includes("functionalTesting")||f.includes("handler/rest/"))&&!f.includes("/dto/"))?"<route precondition>":"Unit test of the REPO package in "+f+" over in-memory fakes.";
window.__D=async(a)=>{const tok=(await fetch("/slm/webservice/v2.0/security/authorize",{credentials:"include"}).then(r=>r.json())).OperationResult.SecurityToken;const out=[];for(const [k,n,f,i,e] of a){const body={TestCase:{Name:n+" (REPO)",Method:"Automated",Type:"Functional",WorkProduct:"/hierarchicalrequirement/STORY_OID",Project:"/project/PROJECT_OID",PreConditions:window.__P(f),ValidationInput:i,ValidationExpectedResult:e,Objective:"STORY TITLE: "+n+". Test file: "+f}};const r=await fetch("/slm/webservice/v2.0/testcase/create?key="+tok,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(r=>r.json());const er=r.CreateResult.Errors;out.push(k+":"+(er.length?"ERR "+er[0]:r.CreateResult.Object.FormattedID.slice(2)));}return out.join(",");};"ok"
```

Load every TC of the story (id → name, ref):

```js
window.__R={};let s=1;for(;;){const q=await fetch("/slm/webservice/v2.0/hierarchicalrequirement/STORY_OID/TestCases?fetch=FormattedID,Name&pagesize=2000&start="+s,{credentials:"include"}).then(r=>r.json());for(const r of q.QueryResult.Results)window.__R[+r.FormattedID.slice(2)]={n:r.Name,ref:r._ref};s+=2000;if(s>q.QueryResult.TotalResultCount)break;}Object.keys(window.__R).length
```

Update old TCs (rows `[id, caseText, file, input, expected, newPre(0|1)]`):

```js
window.__U=async(items)=>{const tok=(await fetch("/slm/webservice/v2.0/security/authorize",{credentials:"include"}).then(r=>r.json())).OperationResult.SecurityToken;const out=[];for(const [id,name,file,inp,exp,np] of items){const ref=window.__R[id].ref;const t=(await fetch(ref+"?fetch=Objective",{credentials:"include"}).then(r=>r.json())).TestCase;const o=t.Objective||"";const ix=o.indexOf("): ");const oc0=name.replace(/^(US|AC)-\d+ /,"");const oc=oc0.charAt(0).toUpperCase()+oc0.slice(1);const body={Name:name+" (REPO)",Objective:(ix>0?o.slice(0,ix+3):"STORY TITLE: ")+oc+(ix>0?".":". Test file: "+file),ValidationInput:inp,ValidationExpectedResult:"Outcome: "+oc+". Asserted: "+exp};if(np)body.PreConditions=window.__P(file);const r=await fetch(ref+"?key="+tok,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({TestCase:body})}).then(r=>r.json());const e=r.OperationResult.Errors;out.push(id+":"+(e.length?"ERR "+e[0]:"ok"));}return out.join(",");};"ok"
```

## Flow for a PR round

1. Write tests with placeholders `[TCNEW01]…` (never invent real ids). Keep a list: placeholder, case text, test file.
2. For each case, the TC's input and expected result are the case's `input:` and `expected:` log text.
   The precondition comes from the test layer (unit / functional rig / DB / e2e).
3. Look up each name first (an earlier round may have created it). Create only the missing ones. Note `placeholder:id` after every call.
4. Replace each `[TCNEWnn]` with its `[TC<id>]` in the code.
5. Check every name in the code matches its Rally TC. Update old TCs whose test text changed with `__U`.
6. Report to the user: created ids, updated ids, and orphaned ids (tests deleted) to close.

## Moving the case list into the Rally tab (learned on PR #229)

- `fetch("http://127.0.0.1:...")` from the Rally tab hangs, so do not serve rows over HTTP to the page.
- Instead: write `page.html` containing `<script>window.name=<JSON string of the rows>;</script>`, serve it with a
  tiny local node server, `navigate` the tab to it, then `navigate` the same tab to the Rally WSAPI URL and read
  `JSON.parse(window.name)`. `window.name` survives the cross-site navigation. Stop the server and close the tab after.
- Build the rows from `go test -json` output with node (no python here): key by `[TCNEWnn]`, take `input:` and
  `expected:` lines, drop random temp paths and pointers, cap input at ~900 and expected at ~500 characters.
- A result that contains `=` pairs, URLs or query strings is blocked: return `key:value,key:value` instead.
- Concurrency conflicts on create are normal (other teams create at the same time). Look the name up first, retry up
  to 4 times, then reconcile by name. Check at the end that all ids are unique and every name matches the code.
- Replace placeholders in code with a loop over `sed -i` per file (an IDE lock can make one `sed` fail; rerun until
  `grep TCNEW` is empty).
- Renames: PUT the new `Name` (`<case text> (<repo>)`) and, for a moved layer, the new `PreConditions`.
