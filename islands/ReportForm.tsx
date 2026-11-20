import { useMemo, useState } from "preact/hooks";
import { detectContactInfo } from "../lib/sanitize.ts";

export const CATEGORIES = [
  "贪污受贿 / 利益输送",
  "财务造假",
  "数据与隐私泄露",
  "骚扰、歧视等职场不当行为",
  "违反安全或合规规范",
  "其他",
];

interface Props {
  initial?: { title?: string; category?: string; description?: string };
  confirmed?: boolean;
}

export default function ReportForm(props: Props) {
  const [title, setTitle] = useState(props.initial?.title ?? "");
  const [description, setDescription] = useState(
    props.initial?.description ?? "",
  );

  // 输入时实时检测可能暴露身份的内容(纯浏览器端,内容不会发出)
  const warnings = useMemo(
    () => detectContactInfo(title + "\n" + description),
    [title, description],
  );

  return (
    <form method="post" enctype="multipart/form-data" class="form">
      {props.confirmed && <input type="hidden" name="confirmed" value="1" />}

      <label>
        标题
        <input
          type="text"
          name="title"
          required
          maxLength={80}
          placeholder="一句话概括问题,例如:某项目采购存在利益输送"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        />
      </label>

      <label>
        类别
        <select name="category" required>
          {CATEGORIES.map((c) => (
            <option value={c} selected={props.initial?.category === c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label>
        详细描述
        <textarea
          name="description"
          required
          rows={10}
          maxLength={5000}
          placeholder="请描述事情经过、涉及人员(被举报人)、时间、地点、涉及金额等。请不要写下你自己的姓名、工号或联系方式。"
          value={description}
          onInput={(e) =>
            setDescription((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      <p class="muted small">{description.length} / 5000</p>

      {warnings.length > 0 && (
        <div class="warn-box">
          ⚠️ 检测到可能暴露你身份的内容:{warnings.join("、")}。
          建议删除后再提交;如确属必要,可继续提交。
        </div>
      )}

      <label>
        附件(可选,单个不超过 5MB)
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,.pdf,.txt,.zip,.docx,.xlsx"
        />
      </label>
      <p class="muted small">
        JPEG/PNG 图片会在服务器端自动剥离 EXIF 等元数据;PDF、Office
        等文件的属性信息无法自动清除,建议先自行检查"文件属性"再上传。
      </p>

      <button type="submit" class="btn primary">提交举报</button>
    </form>
  );
}
