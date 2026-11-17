# Pipeline

Transforms extracted document Markdown into a structured syntax tree for speech classification and narration.

## Language

**Cleave**:
Splitting a syntax node at a character boundary into two sibling nodes so each side falls cleanly within a text span boundary.
_Avoid_: Slice, chop, partition

**Straddling Node**:
An inline syntax node whose content crosses a boundary of a text span, such as a formatting node spanning across a sentence or parenthetical boundary.
_Avoid_: Spanning inline, cross-boundary node
