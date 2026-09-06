#!/usr/bin/env python3
"""jango.html(아티팩트용 소스) -> 정적 배포용 index.html 빌드"""
import sys, pathlib

SRC = pathlib.Path('/home/claude/jango.html')
OUT = pathlib.Path('/mnt/user-data/outputs/jango-app/index.html')

OLD_OFFER = '''async function offer(filename, data){
  let dl=null;
  try{ dl = await window.claude.use("downloads"); }catch(e){}
  if(!dl){ toast("이 화면에선 저장이 안 돼요"); return; }
  try{ await dl.save({filename, data}); toast("저장했어요"); }
  catch(e){ if(e && e.code==="declined") return; toast("저장하지 못했어요"); }
}'''
NEW_OFFER = '''async function offer(filename, data){
  /* 아티팩트에서는 downloads 캐퍼빌리티, 일반 웹에서는 Blob 다운로드 */
  let dl=null;
  try{ dl = (window.claude && window.claude.use) ? await window.claude.use("downloads") : null; }catch(e){}
  if(dl){
    try{ await dl.save({filename, data}); toast("저장했어요"); }
    catch(e){ if(!(e && e.code==="declined")) toast("저장하지 못했어요"); }
    return;
  }
  try{
    const blob = (data instanceof Blob) ? data : new Blob([data], {type:"application/octet-stream"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=filename; a.style.display="none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1500); toast("내려받았어요");
  }catch(e){ toast("저장하지 못했어요"); }
}'''
OLD_BOOT = 'else if(window.claude && window.claude.use) connectDB();'
NEW_BOOT = OLD_BOOT + '''
if("serviceWorker" in navigator && location.protocol==="https:"){
  window.addEventListener("load", ()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}'''
HEAD = '''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F6F5F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131512" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="잔고와 흐름">
<meta name="description" content="숫자패드로 3초에 기록하는 개인 가계부 · 자산 트래커">
<link rel="manifest" href="./manifest.json">
<link rel="icon" href="./icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<style>html{color-scheme:light dark}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
'''
src = SRC.read_text(encoding='utf-8')
for old, new, name in ((OLD_OFFER, NEW_OFFER, 'offer()'), (OLD_BOOT, NEW_BOOT, 'boot')):
    if old not in src:
        sys.exit(f'패치 지점 없음: {name}')
    src = src.replace(old, new, 1)
OUT.write_text(HEAD + src + '\n</body>\n</html>\n', encoding='utf-8')
print(f'{OUT} ({OUT.stat().st_size:,} bytes)')
