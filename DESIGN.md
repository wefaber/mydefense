# Design

Extends the WeFaber house design (`~/.claude/standards/DESIGN.md`). Only deviations and product specifics below.
Theme: **teal** (`@wefaber/tokens`, LearnIt suite), light + dark. Reference points: LearnIt, the Eternum study tool.

## Principles specific to this product

- One thing per screen: pick a team, pick who you are, practice. At most three options at each step.
- Practice is calm: no streaks, no points, no confetti. The scale is words: Completa · Parcial · Insuficiente.
- Self-grading first. The user decides how well they answered; the app never judges in F1.
- Privacy is stated where progress is shown: "Tu progreso queda en este navegador."

## Tokens

`@import "@wefaber/tokens/themes/teal.css"; @import "@wefaber/tokens/theme.css";` Components use roles
(`bg-bg`, `bg-surface`, `text-text`, `text-muted`, `bg-accent`, `text-on-accent`, `border-border`), never raw colors.
Status colors: `success` (Completa / verificado), `warning` (Parcial / completar), `danger` (Insuficiente / definir),
always with an icon or label.

## Layout and shells

- Centered column, max width `4xl` (56 rem) for reading screens; the control strip (identity chips + tabs) is sticky.
- Tabs are selectable sections, one at a time, with a 200 ms fade (`SectionTransition`).
- Long pages have `BackToTop`.

## Views

1. **Elegí equipo**: list of public teams.
2. **Elegí identidad**: one tile per identity (name, role, sectors).
3. **Práctica**: tabs Mis puntos · Quiz · Banco · Temas · Ejercicios · Pendientes · Datos.

## Touch flows

Products are touch first: 44 px targets, tabs scroll horizontally on narrow screens.

## Done checklist additions

- [ ] Progress copy says it stays in the browser.
- [ ] Spanish copy rioplatense ("Elegí", "Marcá", "Tocá"), no exclamation marks.
