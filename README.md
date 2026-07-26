# claude-myoffice

Trung tâm điều hành cá nhân cho Claude Code — "bộ não" chứa persona điều hành, các agent vai trò và workflow điều phối, dùng chung cho **mọi repo** trên máy local. Sửa một nơi, mọi dự án hưởng.

## Cài đặt (1 lần / máy)

```bash
git clone https://github.com/huyleresonancetech/claude-myoffice.git ~/claude-myoffice
~/claude-myoffice/setup.sh
```

Script chỉ tạo **symlink** từ `~/.claude/` trỏ về repo — không ghi đè config sẵn có (file lạ sẽ được SKIP và báo). Update sau này chỉ cần `git pull`. Ba thứ được link:

| Nguồn | Đích | Vai trò |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | Bộ não: persona điều hành + quy tắc chung, nạp ở **mọi session, mọi repo** |
| `agents/*.md` | `~/.claude/agents/` | Đội agent vai trò |
| `skills/*/` | `~/.claude/skills/` | Các workflow (`/brief`, `/delegate`) |

## Dùng

Quy trình đầy đủ là 2 bước — thiết kế task cùng nhau, rồi giao cho đội chạy:

```
/brief "backend Laravel cho pawcast"
   → phỏng vấn có cấu trúc: goal, definition of done, scope In/Out, constraints, verify
   → xuất file plan: docs/plans/2026-07-26-pawcast-backend.md

/delegate "implement plan tại docs/plans/2026-07-26-pawcast-backend.md"
   → pipeline chạy plan đó (planner chỉ validate + decompose, không tự nghĩ lại)
```

Task đã rõ sẵn thì giao thẳng, bỏ qua `/brief`:

```
/delegate "thêm segment mới cho landing page, copy lấy từ 01-segments/9-xxx.md"
```

### Pipeline của /delegate

```
/delegate "<task | plan file>"
  ├─ Triage ── SIMPLE → làm thẳng, không orchestrate (nhanh hơn)
  ├─ [1] scout        song song, read-only — hiểu code liên quan
  │        └─ greenfield → đọc plan + môi trường thay vì code
  ├─ [2] planner      chia subtask độc lập, file ownership rời nhau
  │        ├─ plan có sẵn → validate + decompose, bất đồng phải nêu rõ
  │        └─ COMPLEX → ⏸ trình plan, chờ duyệt
  ├─ [3] implementer  N agent song song, mỗi agent 1 subtask
  │        └─ greenfield → subtask scaffold chạy tuần tự TRƯỚC khi fan-out
  ├─ [4] reviewer ∥ tester   review adversarial + chạy build/lint/test
  ├─ [5] fix loop     (tối đa 3 vòng, không bao giờ nới lỏng check)
  └─ [6] deliver      báo cáo → commit → push
           └─ COMPLEX → ⏸ trình diff, chờ duyệt trước khi push
           └─ KHÔNG BAO GIỜ tự tạo PR khi chưa được confirm
```

### Vai trò

| Agent | Model | Quyền | Việc |
|---|---|---|---|
| `scout` | haiku | read-only | Trinh sát codebase, trả về briefing |
| `planner` | inherit (mạnh nhất) | read-only | Plan + chia subtask song song được, cắm cờ rủi ro |
| `implementer` | sonnet | edit | Thực thi đúng 1 subtask, trong đúng file được giao |
| `reviewer` | inherit (mạnh nhất) | read-only | Soi lỗi thật trên diff, verdict APPROVE/NEEDS_FIXES |
| `tester` | sonnet | bash + viết test | Tự tìm và chạy check của repo, verdict GREEN/RED |

Bộ não điều hành **không phải một agent riêng** — chính main session (Claude bạn đang chat) đọc SKILL.md và trở thành orchestrator. Nhờ vậy các gate duyệt plan/diff hỏi thẳng bạn được, không qua trung gian.

### Gate duyệt (khi nào nó dừng lại hỏi)

Task bị coi là **COMPLEX** — phải duyệt plan trước khi code và duyệt diff trước khi push — khi chạm ≥1 tiêu chí:

- đụng >3 file có ý nghĩa
- yêu cầu mơ hồ (2 cách hiểu hợp lý cho ra kết quả khác nhau)
- đổi schema / public API / dependency
- thao tác khó đảo ngược: migration, xóa data, config production, tracking/payment ID live
- thay đổi xuyên nhiều bề mặt (vd: copy + tracking + data)

Không chạm tiêu chí nào → chạy thẳng tới push, chỉ báo cáo.

## Cấu trúc repo

```
CLAUDE.md          # bộ não: persona + quy tắc global, symlink → ~/.claude/CLAUDE.md
agents/            # mỗi file .md = 1 vai trò (frontmatter: model, tools + system prompt)
skills/brief/      # /brief — thiết kế task cùng user → file plan
skills/delegate/   # /delegate — playbook điều phối
setup.sh           # symlink vào ~/.claude/
```

## Mở rộng

- **Thêm vai trò**: tạo `agents/<tên>.md` (bắt chước format file sẵn có), chạy lại `setup.sh`, nhắc đến nó trong `skills/delegate/SKILL.md` nếu muốn pipeline dùng.
- **Thêm workflow**: tạo `skills/<tên>/SKILL.md`, chạy lại `setup.sh` → có ngay lệnh `/<tên>`.
- **Chỉnh gate/model**: sửa trực tiếp `skills/delegate/SKILL.md` (tiêu chí COMPLEX) hoặc frontmatter `model:` trong từng agent.
- **Ghi quy tắc mới**: quyết định bền vững → thêm vào `CLAUDE.md` (global) hoặc skill liên quan, commit lại.

## Quyết định thiết kế đã chốt (2026-07-26)

- Tối giản thay vì port gstack: 5 vai trò + 2 skill tái tạo đủ 3 nguyên tắc lõi (role cụ thể, artifact chuyền tay, quality gate) — không ôm 23 skill.
- Symlink thay vì copy: một nguồn sự thật, `git pull` là xong.
- Model phân tầng: rẻ-nhanh cho trinh sát/chạy test, mạnh nhất cho plan/review — nơi sai lầm đắt nhất.
- Task SIMPLE đi thẳng không qua pipeline: orchestration có chi phí, chỉ đáng khi task chia được.
- Tên skill theo hành động của user (`/brief`, `/delegate`) thay vì từ khóa lĩnh vực (`/dev`, `/design`) — tránh trùng/nhầm với skill khác.
- Bộ não = main session + `CLAUDE.md` global, KHÔNG phải orchestrator subagent — subagent không hội thoại trực tiếp với user nên gate duyệt sẽ gãy, và mất context qua trung gian.
- Thiết kế task cùng user là **skill** (main loop, hội thoại được), không phải subagent.
