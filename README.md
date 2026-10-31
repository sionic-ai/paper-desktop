# 나란 (nanran)

영어 논문을 왼쪽에 원문, 오른쪽에 한국어 번역으로 나란히 보여 주는 macOS 데스크톱 앱입니다. 한쪽 문장에 마우스를 올리면 짝이 되는 문장이 양쪽에서 함께 하이라이트됩니다. 번역은 이 Mac에 로그인된 [Claude Code](https://docs.claude.com/claude-code)로 하므로 API 키가 필요 없습니다.

## 설치

```sh
curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash
```

이 한 줄이 하는 일:

1. 최신 릴리스의 `Nanran.app`(Apple Silicon·Intel 공용)을 받아 `/Applications`에 넣습니다. 쓰기 권한이 없으면 `~/Applications`에 넣습니다.
2. Claude Code가 없으면 공식 설치 스크립트(`https://claude.ai/install.sh`)로 설치합니다.
3. Claude Code에 로그인되어 있지 않으면 `claude auth login`을 띄웁니다. 브라우저에서 로그인하면 끝납니다.
4. 앱을 엽니다. 앱은 실행할 때마다 Claude Code 로그인 상태를 확인하고, 로그인이 안 되어 있으면 상단에 안내를 띄웁니다.

이미 Claude Code에 로그인되어 있다면 설치가 끝나는 즉시 번역과 AI 찾기를 쓸 수 있습니다.

옵션은 `bash -s --` 뒤에 붙입니다.

```sh
curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash -s -- --no-open
```

| 옵션 | 환경 변수 | 내용 |
|---|---|---|
| `--no-claude` | `NANRAN_NO_CLAUDE=1` | Claude Code 설치·로그인 단계를 건너뜁니다 |
| `--no-login` | `NANRAN_NO_LOGIN=1` | Claude Code가 없으면 설치만 하고 로그인은 시작하지 않습니다 |
| `--no-open` | `NANRAN_NO_OPEN=1` | 설치 후 앱을 열지 않습니다 |
| `--dir <path>` | `NANRAN_DIR` | 앱을 설치할 폴더 |
| `--version <tag>` | `NANRAN_VERSION` | 특정 릴리스 태그(기본 latest) |
| `--check` | | 설치 상태만 출력하고 아무것도 바꾸지 않습니다 |

종료 코드는 `0` 준비 완료, `1` 오류, `2` 앱은 설치됐지만 Claude Code 로그인이 필요함입니다. 에이전트에게 설치를 맡길 때의 절차는 [AGENTS.md](AGENTS.md)에 있습니다.

다시 실행하면 최신 버전으로 덮어씁니다. 지우려면 `rm -rf /Applications/Nanran.app`을 실행하고, 저장된 논문까지 지우려면 `~/Library/Application Support/dev.rlaope.nanran`도 삭제합니다.

> 앱은 Apple 공증을 받지 않은 ad-hoc 서명 빌드입니다. 설치 스크립트가 다운로드 격리 속성(`com.apple.quarantine`)을 지워서 바로 열립니다. 릴리스 zip을 브라우저로 직접 받았다면 처음 한 번은 Finder에서 앱을 우클릭하고 `열기`를 누르거나 `xattr -dr com.apple.quarantine /Applications/Nanran.app`을 실행합니다.

요구 사항: macOS 11 이상, Claude Code 계정(claude.ai 구독 또는 Console).

## 기능

- **찾기**: 왼쪽 칸에 검색어(`flash attention`, `"sliding window" mistral`)를 넣으면 arXiv를 앱 안에서 검색합니다. 결과에서 바로 나란히 읽거나 arxiv.org를 기본 브라우저로 열 수 있습니다
- **AI로 찾기**: 왼쪽 칸의 `AI로 논문 찾기`에 원하는 주제를 말로 적으면 Claude가 arXiv를 검색해 논문 번호와 링크를 추천합니다. 말풍선의 `번역하기`를 누르면 그 논문을 가져와 바로 나란히 읽기로 열고 번역을 시작합니다
- **불러오기**: arXiv ID나 주소(`1706.03762`, `https://arxiv.org/abs/2310.06825`)는 바로 가져오고, 로컬 PDF 파일도 열 수 있습니다
- **번역 문체**: 교재처럼 읽히는 합니다체로 번역합니다. 영어 어순을 따르지 않고 한국어 어순으로 다시 짜며, 처음 나오는 전문 용어는 `파국적 망각(catastrophic forgetting)`처럼 영어를 함께 적습니다. 섹션 제목도 `1 Introduction | 1 서론`처럼 나란히 번역하고, 논문 제목은 영어 그대로 두 칸에 걸쳐 한 번만 보여 줍니다. 예전 문체로 번역한 논문에는 상단에 `새 문체로 다시 번역 ▾` 버튼이 뜨고, 여기서도 `그냥 번역`과 `쉽게 번역`을 고를 수 있습니다. 다시 번역하는 동안에도 기존 번역은 그대로 보입니다
- **쉽게 읽기**: `번역하기`를 누르면 `그냥 번역`과 `쉽게 번역`을 고를 수 있습니다. 쉽게 번역은 문장마다 짝을 유지한 채, 어려운 용어를 `파인튜닝(이미 학습된 모델을 특정 작업에 맞게 조금 더 학습시키는 것)`처럼 풀어 쓰고 생략된 이유를 짧게 덧붙입니다. 사실·수치·단서는 원문대로 둡니다. 둘 다 만들어 두면 상단의 `번역 | 쉽게 읽기` 스위치로 오가며, 논문마다 마지막에 본 쪽으로 열립니다. 쉽게 번역은 `<id>.easy.json`에 따로 저장됩니다
- **나란히 읽기**: 문장 단위로 원문과 번역을 짝지어 보여 줍니다. 상단의 `⇄` 버튼으로 원문과 한국어의 좌우 위치를 바꿀 수 있습니다. 두 칸 사이 경계를 끌면 한쪽을 더 넓게 볼 수 있고, 두 번 누르면 반반으로 돌아갑니다
- **다크 모드**: 사이드바 왼쪽 아래의 달/해 아이콘으로 라이트와 다크를 바꿉니다. 처음에는 macOS 설정을 따르고, 고른 뒤에는 그 선택이 남습니다
- **사이드바**: 오른쪽 가장자리를 끌어 너비를 조절하고, 상단 아이콘이나 `⌘B`로 접고 펼칩니다. 아주 좁게 끌어도 접힙니다. 너비와 상태는 다음 실행에도 남습니다
- **물어보기**: 오른쪽 아래 떠 있는 ✦ 버튼을 누르고 질문을 적어 Enter를 치면 대화창이 열리고, Claude가 열린 논문을 근거로 답합니다. 첫 글자가 나오기 전까지는 Claude Code처럼 `✻ 생각하는 중…` 상태가 보이고, 답은 쓰이는 대로 바로 흘러나옵니다. 본문을 드래그하면 작은 입력창이 떠서 질문을 적고 Enter(또는 ↵ 버튼)로 그 부분과 함께 보낼 수 있습니다. 입력하거나 스크롤해도 고른 부분은 표시된 채 남습니다
- **업데이트**: 새 릴리스가 나오면 왼쪽 칸 맨 아래에 파란 `업데이트` 버튼이 뜹니다. 누르면 설치 스크립트로 새 버전을 받아 교체하고 다시 엽니다
- **저장**: 논문과 번역은 `~/Library/Application Support/dev.rlaope.nanran/papers/`에만 저장됩니다

## 소스에서 빌드

필요한 것: Rust 1.85 이상, Node 20 이상, pnpm, 로그인된 `claude` CLI(`claude auth status`로 확인)

```sh
pnpm install
pnpm dev                 # 개발 실행
pnpm tauri build         # src-tauri/target/release/bundle/macos/Nanran.app 생성
scripts/release.sh       # 유니버설 빌드 후 GitHub 릴리스에 올림 (관리자용)
```

## 동작 방식

| 단계 | 위치 | 내용 |
|---|---|---|
| arXiv | `src-tauri/src/arxiv.rs` | arXiv HTML(LaTeXML)을 섹션, 문단, 그림, 표, 수식 단위로 파싱합니다. HTML 판이 없으면 PDF로 대신 처리합니다. 그림은 data URL로 임베드합니다. |
| 검색 | `src-tauri/src/search.rs` | arXiv 공개 API(`export.arxiv.org/api/query`)에 모든 단어가 들어간 논문을 관련도순으로 20개씩 요청하고 Atom 응답을 파싱합니다. 따옴표로 묶은 구절은 붙여서 찾습니다. arxiv.org 열기는 ID만 받아 `https://arxiv.org/abs/<id>`로만 엽니다. |
| AI 추천 | `src-tauri/src/recommend.rs` | Claude가 요청을 영어 검색어 3개 이내와 확신하는 arXiv ID로 바꾸고, 앱이 arXiv API로 실제 결과를 가져온 뒤 Claude가 그 안에서만 최대 5개를 고릅니다. 후보에 없는 ID는 버리므로 존재하지 않는 논문 링크는 나오지 않습니다. 요청 하나에 Claude 호출 2번과 arXiv 요청 최대 4번이 들어가고 15초 안팎 걸립니다. |
| 질문 | `src-tauri/src/ask.rs` | `claude -p --output-format stream-json`으로 답을 조각조각 받아 Tauri Channel로 화면에 흘려 보냅니다. 열린 논문을 수식까지 복원한 영어 평문(최대 6만 자, 선택 부분이 뒤쪽이면 그 주변)으로 만들어 선택 문장, 최근 대화 8개와 함께 Claude에 보냅니다. 답은 한국어 평문입니다. |
| 업데이트 | `src-tauri/src/update.rs` | `releases/latest`의 리다이렉트 태그로 최신 버전을 확인하고(실패하면 버튼을 숨김), 설치를 누르면 `install.sh`를 앱과 분리된 프로세스로 `NANRAN_DIR=<현재 앱 폴더> NANRAN_NO_CLAUDE=1`과 함께 실행합니다. 기록은 `$TMPDIR/nanran-update.log`에 남습니다. |
| PDF | `src-tauri/src/pdf.rs` | 텍스트를 추출한 뒤 제목과 번호 붙은 섹션을 복원합니다. 쪽 번호를 제거하고, 줄 끝 하이픈을 문서 어휘를 기준으로 판정해 이어 붙입니다. |
| 문장 | `src-tauri/src/sentence.rs` | 학술 약어(e.g., Fig., et al. 등)를 고려해 문장을 분할합니다. |
| 번역 | `src-tauri/src/translate.rs` | `claude -p`를 도구, MCP, 설정을 모두 끈 상태로 빈 임시 폴더에서 실행합니다. 문단 ID와 문장 수가 1:1로 맞는 JSON을 받고, 맞지 않는 문단은 단독으로 다시 요청합니다. 3개 배치를 동시에 처리합니다. |
| Claude 연결 | `src-tauri/src/translate.rs` | `~/.local/bin/claude`, `~/.claude/local/claude`, Homebrew 경로, PATH 순서로 CLI를 찾습니다. 로그인 여부는 모델 호출 없이 `claude auth status`로 확인합니다. |
| 리더 | `src/Reader.tsx` | 행마다 원문과 번역을 2열 그리드로 배치합니다. 인라인 수식은 `⟦M n⟧` 토큰으로 번역에서 보존한 뒤 KaTeX로 렌더합니다. hover하면 CSS 규칙 하나만 바꿔 같은 `data-s`를 가진 두 문장을 칠합니다. |

명령줄 점검용 바이너리도 함께 들어 있습니다.

```sh
cd src-tauri
cargo run --release --features probe --bin nanran-probe -- claude -                # Claude Code 설치·로그인 상태
cargo run --release --features probe --bin nanran-probe -- search 'flash attention' # arXiv 검색
cargo run --release --features probe --bin nanran-probe -- ask 'KV 캐시 압축 논문 추천해줘' # AI 추천
cargo run --release --features probe --bin nanran-probe -- update                  # 최신 릴리스 확인
cargo run --release --features probe --bin nanran-probe -- askpaper arxiv-1706.03762 '핵심이 뭐야?' # 논문에 질문
cargo run --release --features probe --bin nanran-probe -- parse 1706.03762        # 블록 통계
cargo run --release --features probe --bin nanran-probe -- dump paper.pdf          # 블록별 한 줄 출력
cargo run --release --features probe --bin nanran-probe -- translate 1706.03762 6  # 앞 6개 문단 번역
cargo run --release --features probe --bin nanran-probe -- job paper.pdf /tmp/lib  # 앱과 같은 전체 번역 작업
cargo run --release --features probe --bin nanran-probe -- redo <doc-id> /tmp/lib  # 저장된 논문을 새 문체로 다시 번역
NANRAN_MODE=easy cargo run --release --features probe --bin nanran-probe -- translate 2510.15103 6  # 쉽게 번역으로 확인
```

## 한계

- macOS 전용입니다.
- PDF는 텍스트 레이어만 사용합니다. 스캔본은 읽지 못하고, PDF의 수식, 그림, 표는 원문 텍스트로만 표시됩니다.
- 번역 품질과 속도는 Claude Code 계정의 모델과 사용량 한도를 따릅니다.
