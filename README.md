# claude-myoffice

Trung tâm điều hành cá nhân cho Claude Code — "bộ não" chứa các agent vai trò và workflow điều phối, dùng chung cho **mọi repo** trên máy local. Sửa một nơi, mọi dự án hưởng.

## Cài đặt (1 lần / máy)

```bash
git clone https://github.com/huyleresonancetech/claude-myoffice.git ~/claude-myoffice
~/claude-myoffice/setup.sh
```

Script chỉ tạo **symlink** từ `~/.claude/agents/` và `~/.claude/skills/` trỏ về repo — không ghi đè config sẵn có (file lạ sẽ được SKIP và báo). Update sau này chỉ cần `git pull`.

## Dùng

Mở bất kỳ repo nào bằng Claude Code rồi giao task:

```
/dev "thêm segment mới cho landing page, copy lấy từ 01-segments/9-xxx.md"
```

### Pipeline

```
/dev "<task>"
  ├─ Triage ── SIMPLE → làm thẳng, không orchestrate (nhanh hơn)
  ├─ [1] scout        song song, read-only — hiểu code liên quan
  ├─ [2] planner      chia subtask độc lập, file ownership rời nhau
  │        └─ COMPLEX → ⏸ trình plan, chờ duyệt
  ├─ [3] implementer  N agent song song, mỗi agent 1 subtask
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
agents/          # mỗi file .md = 1 vai trò (frontmatter: model, tools + system prompt)
skills/dev/      # /dev — playbook điều phối
setup.sh         # symlink vào ~/.claude/
```

## Mở rộng

- **Thêm vai trò**: tạo `agents/<tên>.md` (bắt chước format file sẵn có), chạy lại `setup.sh`, nhắc đến nó trong `skills/dev/SKILL.md` nếu muốn pipeline dùng.
- **Thêm workflow**: tạo `skills/<tên>/SKILL.md`, chạy lại `setup.sh` → có ngay lệnh `/<tên>`.
- **Chỉnh gate/model**: sửa trực tiếp `skills/dev/SKILL.md` (tiêu chí COMPLEX) hoặc frontmatter `model:` trong từng agent.

## Quyết định thiết kế đã chốt (2026-07-26)

- Tối giản thay vì port gstack: 5 vai trò + 1 skill tái tạo đủ 3 nguyên tắc lõi (role cụ thể, artifact chuyền tay, quality gate) — không ôm 23 skill.
- Symlink thay vì copy: một nguồn sự thật, `git pull` là xong.
- Model phân tầng: rẻ-nhanh cho trinh sát/chạy test, mạnh nhất cho plan/review — nơi sai lầm đắt nhất.
- Task SIMPLE đi thẳng không qua pipeline: orchestration có chi phí, chỉ đáng khi task chia được.
