# 02 Provider and plugin connections

Connect providers only when credentials already exist and connection can be made without new spending or subscription. Never expose secrets in logs or source.

Targets: OpenAI, Gemini, DeepSeek model lanes; web/search; browser; files; code/test; GitHub; data/spreadsheet/document/media; email; CRM; research; calendar/contacts/cloud drive/database/deploy/design; voice STT/TTS; invoice/payment evidence/accounting.

Use the central Tool Fabric + Tool Bridge + Universal Connector + Executor Toolbox. Do not duplicate a separate tool stack per agent. Mark PLACEHOLDER_UNCONNECTED, CONNECTED_UNTESTED, or LIVE truthfully. LIVE requires a real test.

Do not make paid probe/API calls unless JOCI explicitly approves the cost.
