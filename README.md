# 나란 (nanran)

영어 논문을 왼쪽에 원문, 오른쪽에 한국어 번역으로 나란히 보여 주는 macOS 데스크톱 앱입니다. 한쪽 문장에 마우스를 올리면 짝이 되는 문장이 양쪽에서 함께 하이라이트됩니다.

- **불러오기**: arXiv ID나 주소(`1706.03762`, `https://arxiv.org/abs/2310.06825`), 또는 로컬 PDF 파일
- **번역**: 이 Mac에 로그인된 [Claude Code](https://docs.claude.com/claude-code) CLI를 사용하며, API 키는 필요 없습니다
- **저장**: 논문과 번역은 `~/Library/Application Support/dev.rlaope.nanran/papers/`에만 저장됩니다

## 실행

필요한 것: Rust 1.85 이상, Node 20 이상, pnpm, 로그인된 `claude` CLI(`claude auth status`로 확인)

```sh
pnpm install
pnpm dev                 # 개발 실행
pnpm tauri build         # src-tauri/target/release/bundle/macos/Nanran.app 생성
```

## 동작 방식

| 단계 | 위치 | 내용 |
|---|---|---|
| arXiv | `src-tauri/src/arxiv.rs` | arXiv HTML(LaTeXML)을 섹션, 문단, 그림, 표, 수식 단위로 파싱합니다. HTML 판이 없으면 PDF로 대신 처리합니다. 그림은 data URL로 임베드합니다. |
| PDF | `src-tauri/src/pdf.rs` | 텍스트를 추출한 뒤 제목과 번호 붙은 섹션을 복원합니다. 쪽 번호를 제거하고, 줄 끝 하이픈을 문서 어휘를 기준으로 판정해 이어 붙입니다. |
| 문장 | `src-tauri/src/sentence.rs` | 학술 약어(e.g., Fig., et al. 등)를 고려해 문장을 분할합니다. |
| 번역 | `src-tauri/src/translate.rs` | `claude -p`를 도구, MCP, 설정을 모두 끈 상태로 빈 임시 폴더에서 실행합니다. 문단 ID와 문장 수가 1:1로 맞는 JSON을 받고, 맞지 않는 문단은 단독으로 다시 요청합니다. 3개 배치를 동시에 처리합니다. |
| 리더 | `src/Reader.tsx` | 행마다 원문과 번역을 2열 그리드로 배치합니다. 인라인 수식은 `⟦M n⟧` 토큰으로 번역에서 보존한 뒤 KaTeX로 렌더합니다. hover하면 CSS 규칙 하나만 바꿔 같은 `data-s`를 가진 두 문장을 칠합니다. |

명령줄 점검용 바이너리도 함께 들어 있습니다.

```sh
cd src-tauri
cargo run --release --bin nanran-probe -- parse 1706.03762        # 블록 통계
cargo run --release --bin nanran-probe -- dump paper.pdf          # 블록별 한 줄 출력
cargo run --release --bin nanran-probe -- translate 1706.03762 6  # 앞 6개 문단 번역
cargo run --release --bin nanran-probe -- job paper.pdf /tmp/lib  # 앱과 같은 전체 번역 작업
```

## 한계

- PDF는 텍스트 레이어만 사용합니다. 스캔본은 읽지 못하고, PDF의 수식, 그림, 표는 원문 텍스트로만 표시됩니다.
- 번역 품질과 속도는 Claude Code 계정의 모델과 사용량 한도를 따릅니다.
