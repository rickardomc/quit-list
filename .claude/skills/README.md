# Design skills

Skill per Claude Code usate per il design dell'interfaccia. Copiate dai repository originali, senza modifiche.

| Skill | Origine | Commit | Licenza |
| --- | --- | --- | --- |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) (`.claude/skills/impeccable`) | `8409a56` | Apache 2.0 |
| `hallmark` | [Nutlope/hallmark](https://github.com/Nutlope/hallmark) (`skills/hallmark`) | `65b5e40` | MIT |
| `landing-page-design` | [elayadesign/ai-design-skills](https://github.com/elayadesign/ai-design-skills) (`skills/landing-page-design`) | `ded7efc` | MIT |

Note:
- `impeccable/scripts/impeccable` scarica al primo avvio il proprio motore dalle release GitHub del progetto e lo verifica con `engine-checksums.txt`.
- Gli script di `hallmark` usano Node; `imagegen.mjs` contatta Together AI solo se è impostata `TOGETHER_API_KEY`.
- Per aggiornarle, ricopiare le cartelle dai repository e aggiornare i commit qui sopra.
