# GitHub에 올리고 배포하기

앱을 인터넷 주소로 만드는 과정. 코딩은 없고 파일 올리기 + 스위치 하나 켜기다.
전체 10분 정도.

> **먼저 확실히 해둘 것 — 올라가는 건 코드뿐이다.**
> 가계부 기록은 이 파일들 안에 없다. 브라우저(또는 연결한 구글 시트)에만 있다.
> 시트 URL·토큰도 코드에 안 들어간다. 그래서 **레포를 공개로 둬도 안전하다.**
> (무료 GitHub 계정은 어차피 공개 레포에서만 Pages를 쓸 수 있다.)

---

## 1. 레포 만들기

<https://github.com/new>

| 항목 | 값 |
|---|---|
| Repository name | `jango` (원하는 이름 아무거나) |
| Public / Private | **Public** |
| Add a README file | **체크 해제** (이미 README가 있으니까) |

**Create repository**.

> 레포 이름을 `<내아이디>.github.io` 로 만들면 주소가
> `https://<내아이디>.github.io/` 로 짧아진다. 하나뿐인 특별한 이름이라
> 나중에 다른 걸 만들 계획이 있으면 그냥 `jango` 를 권한다.

## 2. 파일 올리기 — 방법 A: 드래그 앤 드롭 (쉬움)

방금 만든 빈 레포 화면에서 **uploading an existing file** 링크를 누른다.
(이미 파일이 있는 레포면 **Add file → Upload files**)

받은 zip을 풀면 `jango-app` 폴더가 나온다.
**⚠️ 이 폴더를 통째로 끌지 말고, 폴더 안으로 들어가서 내용물을 전부 선택해서** 끌어다 놓는다.

<details>
<summary>왜 그런가</summary>

폴더째로 올리면 저장소가 이렇게 된다.

```
jango/
└── jango-app/
    └── index.html      ← 주소가 …/jango/jango-app/ 이 되어버린다
```

이렇게 돼야 맞다.

```
jango/
├── index.html          ← 주소가 …/jango/ 로 깔끔
├── manifest.json
├── sw.js
└── …
```

이미 잘못 올렸으면 GitHub에서 각 파일 → 연필 → 파일명 앞의 `jango-app/` 를 지우면 옮겨진다.
파일이 몇 개 없으니 그냥 지우고 다시 올리는 게 빠르다.
</details>

`.gitignore` 와 `.nojekyll` 은 점으로 시작해서 탐색기에서 안 보일 수 있다.
- macOS 파인더: `Cmd + Shift + .`
- Windows 탐색기: 보기 → 숨긴 항목 체크

아래 **Commit changes** 를 누른다.

## 2. 파일 올리기 — 방법 B: git 명령어

```bash
cd jango-app
git init
git add .
git commit -m "잔고와 흐름"
git branch -M main
git remote add origin https://github.com/<내아이디>/jango.git
git push -u origin main
```

## 3. Pages 켜기

레포 **Settings** (톱니) → 왼쪽 사이드바 **Pages**

| 항목 | 값 |
|---|---|
| Source | **Deploy from a branch** |
| Branch | **main** / **/ (root)** |

**Save**.

## 4. 주소 확인

1~3분 걸린다. 레포의 **Actions** 탭에 `pages-build-deployment` 가 초록불이 되면 끝.
Settings → Pages 위쪽에 주소가 뜬다.

```
https://<내아이디>.github.io/jango/
```

열어서 8·9월 데이터가 보이면 성공이다.

## 5. 폰에 앱으로 앉히기

폰 브라우저로 같은 주소를 연다.

- **iPhone (사파리)**: 공유 버튼 → **홈 화면에 추가**
- **Android (크롬)**: ⋮ → **홈 화면에 추가** / **앱 설치**

주소창 없이 전체화면으로 뜬다. 오프라인에서도 열린다.

그다음 **설정 → 동기화**에서 구글 시트를 연결한다
(→ [README-시트연결.md](./README-시트연결.md)). 폰과 PC에서 각각 한 번씩 해야 한다.

---

## 나중에 고칠 때

**웹에서**: 레포에서 `index.html` → 연필 아이콘 → 수정 → Commit changes.
**git으로**: 파일 고치고 `git add . && git commit -m "수정" && git push`

푸시하면 1~2분 뒤 자동 반영된다.

바뀐 게 안 보이면 캐시다. 이 앱은 새 버전이 있으면 먼저 가져오게(network-first) 돼 있어서
보통은 새로고침만 하면 되는데, 안 되면:

- 브라우저: **Ctrl/Cmd + Shift + R** (강력 새로고침)
- 홈 화면 앱: 앱을 완전히 닫았다가 다시 열기

## 흔한 문제

**404 페이지가 뜬다**
① Pages가 아직 배포 중 (Actions 탭 확인) ② `index.html` 이 레포 최상단이 아니라
하위 폴더에 있음 (위의 "왜 그런가" 참고) ③ Branch 설정이 `main / (root)` 가 아님.

**화면은 뜨는데 글꼴이 이상하고 엑셀 내보내기가 안 된다**
글꼴(Google Fonts)과 엑셀 모듈(cdnjs)을 외부에서 불러오는데 차단된 경우다.
회사 네트워크나 광고 차단기가 원인인 경우가 많다. 나머지 기능은 다 돌아간다.

**시트 동기화가 "동기화 실패"로 뜬다**
배포와는 무관하다. → [README-시트연결.md](./README-시트연결.md) 의 "자주 걸리는 것".

---

## 레포를 비공개로 두고 싶다면 — Cloudflare Pages

무료 GitHub 계정은 비공개 레포로 Pages를 못 쓴다. 대신 Cloudflare Pages는
비공개 레포도 무료로 배포해 준다. (코드에 비밀이 없으니 굳이 필요하진 않다.)

1. 레포를 **Private** 으로 만들고 위 2번까지 진행
2. <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Connect to Git**
3. GitHub 계정 연결 → 레포 선택
4. 빌드 설정: **Framework preset: None**, **Build command: 비움**, **Build output directory: `/`**
5. Save and Deploy → `https://jango-xxx.pages.dev` 주소가 나온다

푸시하면 자동 재배포되는 건 똑같다. Netlify, Vercel도 방식이 같다.

## 내 도메인을 붙이고 싶다면

도메인이 이미 있다는 전제로,

- **GitHub Pages**: 도메인 DNS에 `CNAME` → `<내아이디>.github.io`
  → Settings → Pages → Custom domain 에 도메인 입력 → **Enforce HTTPS** 체크
- **Cloudflare Pages**: 프로젝트 → Custom domains → 도메인 추가 (DNS가 Cloudflare면 자동)
