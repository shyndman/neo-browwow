# Pipeline

Transforms extracted document Markdown into a structured syntax tree for speech classification and narration.

## Language

**Split**:
Splitting a syntax node at a character boundary into two sibling nodes so each side falls cleanly within a text span boundary.
_Avoid_: Cleave, slice, chop, partition

**Straddling Node**:
An inline syntax node whose content crosses a boundary of a text span, such as a formatting node spanning across a sentence or parenthetical boundary.
_Avoid_: Spanning inline, cross-boundary node

**Judge**:
A model that renders discrete classification or routing decisions over document structure and content.
_Avoid_: Decision model, classifier

**Transcriber**:
A model that converts source document pages into Markdown text.
_Avoid_: Transcription model, vision LLM, OCR model
