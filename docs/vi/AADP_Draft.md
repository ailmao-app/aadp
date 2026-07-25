# AI Application Discovery Protocol (AADP) – Draft

> Ngôn ngữ: Tiếng Việt.
>
> Working Draft v0.1

## 1. Mục tiêu

Đề xuất một giao thức mở giúp AI khám phá và đọc dữ liệu trực tiếp từ ứng dụng (App/API) thay vì phải crawl HTML.

## 2. Động lực

- Người dùng chuyển từ Google Search sang AI Assistant.
- App trở thành nơi diễn ra trải nghiệm chính.
- AI cần dữ liệu có cấu trúc (JSON) thay vì HTML.
- Website dần đóng vai trò landing page hoặc marketing.

## 3. Kiến trúc

```text
AI Client
    │
    ▼
/.well-known/ai-manifest.json
    │
    ▼
AI Sitemap Index
    │
    ├── entities.json
    ├── posts.json
    ├── stories.json
    └── media.json
    │
    ▼
Resource Endpoint (JSON)
```

## 4. Manifest

```json
{
  "version": "0.1",
  "sitemaps": ["/ai/sitemap-index.json"],
  "search": "/ai/search",
  "entity": "/ai/entity/{id}"
}
```

## 5. AI Sitemap

```json
{
  "items": [
    {
      "id": "phu_diep",
      "type": "character",
      "endpoint": "/ai/entity/phu_diep",
      "updated_at": "2026-07-22T00:00:00Z",
      "checksum": "sha256:..."
    }
  ]
}
```

## 6. Entity

```json
{
  "id": "phu_diep",
  "name": "Phù Điệp",
  "type": "character",
  "relationships": [],
  "stories": [],
  "last_activity": ""
}
```

## 7. Nguyên tắc

- API-first
- Entity-first
- JSON-native
- Incremental sync
- Canonical ID
- Versioning
- Cache-friendly

## 8. Authentication

- Public
- API Key
- OAuth
- AI-specific scope

## 9. Lợi ích

- Không cần crawl HTML.
- Đồng bộ nhanh bằng delta.
- Dữ liệu chính xác hơn.
- AI hiểu ngữ nghĩa tốt hơn.
- App trở thành nguồn dữ liệu gốc.

## 10. So sánh

| Công nghệ | Mục tiêu |
|-----------|----------|
| robots.txt | Quy tắc crawler |
| sitemap.xml | Danh sách URL |
| schema.org | Structured Data |
| OpenAPI | Mô tả API |
| MCP | AI ↔ Tool |
| **AADP** | AI ↔ Application Data |

## 11. Roadmap

### v0.1
- Manifest
- Sitemap
- Entity API

### v0.5
- Delta Sync
- Search API
- Authentication

### v1.0
- Chuẩn hóa schema
- Federation
- Community RFC

## Ý tưởng cốt lõi

Internet từng chuyển từ:

```
HTML -> Search Engine
```

Đề xuất mới:

```
Structured JSON -> AI
```

Website không biến mất, nhưng backend/API sẽ trở thành nguồn dữ liệu chính cho cả App, Web và AI.
