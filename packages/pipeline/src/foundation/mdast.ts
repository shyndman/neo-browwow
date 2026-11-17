import type { Parent, Text } from 'mdast';
import type { Data as UnistData, Node as UnistNode } from 'unist';
import { u } from 'unist-builder';
import { splitAtIndex } from './strings';

export interface SplitAwareNodeData<TNode extends UnistNode = Text> {
  onSplit(left: TNode, right: TNode): void;
}

export function isSplitAwareNodeData<TNode extends UnistNode>(
  data: UnistData | undefined,
): data is UnistData & SplitAwareNodeData<TNode> {
  return data !== undefined && 'onSplit' in data;
}

export function isTextNode(node: UnistNode): node is Text {
  return node.type === 'text';
}

export function splitTextNode(node: Text, offset: number): [Text, Text] {
  const [leftValue, rightValue] = splitAtIndex(node.value, offset);
  const leftNode = u('text', leftValue);
  const rightNode = u('text', rightValue);

  if (isSplitAwareNodeData<Text>(node.data)) {
    node.data.onSplit(leftNode, rightNode);
  }

  return [leftNode, rightNode];
}

/**
 * Returns the deepest shared `Parent` from two root-to-leaf ancestor chains.
 */
export function findCommonAncestor(
  startAncestors: readonly Parent[],
  endAncestors: readonly Parent[],
): Parent {
  const maxDepth = Math.min(startAncestors.length, endAncestors.length);
  let commonAncestor = startAncestors[0];

  for (let i = 1; i < maxDepth; i++) {
    if (startAncestors[i] !== endAncestors[i]) break;
    commonAncestor = startAncestors[i];
  }

  if (commonAncestor === undefined) {
    throw new Error('Expected at least one common ancestor for text leaves', {
      cause: { startAncestors, endAncestors },
    });
  }

  return commonAncestor;
}
