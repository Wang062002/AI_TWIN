# Development Workflow

This project is maintained as a long-running product codebase. Code goes to GitHub; private user data stays local.

## Permanent Product Principle

The knowledge-base and cleaning pipeline must be identity-agnostic.

Users may create twins for many different target identities: mother, father, relatives, spouse, current partner, ex-boyfriend, ex-girlfriend, close friend, teacher, colleague, or another important person.

Therefore:

- Do not hard-code "mother" behavior into generic cleaning logic.
- Store `relationship_to_user` as configurable metadata.
- Infer style from each target person's real chat data.
- Use relationship identity only as context, not as a fixed reply template.
- Filtering rules should remove low-value content regardless of identity.
- Prompt rules must adapt to the configured relationship and retrieved evidence.

## Branches

- `main`: stable text-interaction product line.
- `research/*`: exploratory work, such as streaming voice or video interaction.
- `feature/*`: product features.
- `fix/*`: targeted fixes.

## Checks Before Commit

```powershell
npm run check
npm run build:kb:mom
npm run chat:mom:mock
```

For API behavior checks:

```powershell
npm run eval:mom
```

Generic commands for any configured person:

```powershell
npm run build:kb -- --person {person_id}
npm run chat:mock -- --person {person_id}
npm run eval -- --person {person_id}
```

Evaluation versions are isolated under `eval/results/{person_id}/Vn/` so reports only compare the same digital twin.

## Person Configs

Real user-created twins should have a private config file under:

```text
data/person_configs/{person_id}.json
```

This private path takes priority and is ignored by Git. Use `config/people/` only for public, desensitized demo configs.

Use this template:

```text
config/person.example.json
```

Required fields:

- `person_id`
- `display_name`
- `relationship_to_user`
- `source_type`
- `raw_input`
- `knowledge_base_output`
- `privacy_level`

First-batch relationship types are defined in:

```text
config/relationship_types.json
```

## Privacy Rules

Never commit:

- `.env`
- `data/raw/`
- `data/knowledge_bases/`
- `data/person_configs/`
- API keys
- real user chat exports
- files that can identify a user or target person

If sample data is needed, create a separate desensitized sample under:

```text
data/samples/
```

## Suggested GitHub Labels

- `product`: product and business scenarios
- `frontend`: mobile UI prototype
- `kb`: knowledge-base construction
- `cleaning`: data cleaning and filtering
- `retrieval`: retrieval and ranking
- `prompt`: persona and style prompting
- `api`: model API integration
- `safety`: emotional safety and boundaries
- `privacy`: local data and encryption

## Current Technical Route

```text
local chat records
-> identity-agnostic cleaning
-> persona profile and local knowledge base
-> retrieval
-> few-shot / persona / safety prompt
-> API model generation
-> response guard risk check
-> pending memory confirmation
```

`src/response_guard.js` is the shared response-check layer. It currently detects identity-boundary issues, unsupported current real-world status or offline commitments, and near-verbatim copying from retrieved dialogue. Evaluation reports record these risks, and the chat demo prints them for manual review. The next product step is to use the same guard for one automatic regeneration attempt before showing a risky reply to users.
