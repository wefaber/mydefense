import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql'
import type { Plugin } from 'graphql-yoga'

export const MAX_DEPTH = 8
export const MAX_QUERY_CHARS = 4000

const isIntrospection = (name: string) => name.startsWith('__')

function depthOf(
  set: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  seen: Set<string>,
): number {
  let max = 0
  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      if (isIntrospection(sel.name.value)) continue
      const below = sel.selectionSet
        ? depthOf(sel.selectionSet, fragments, seen)
        : 0
      max = Math.max(max, 1 + below)
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(sel.selectionSet, fragments, seen))
    } else {
      const name = sel.name.value
      const fragment = fragments.get(name)
      if (!fragment || seen.has(name)) continue
      seen.add(name)
      max = Math.max(max, depthOf(fragment.selectionSet, fragments, seen))
      seen.delete(name)
    }
  }
  return max
}

/** Validation rule: operations deeper than `maxDepth` are rejected. Introspection fields are not counted. */
export function depthRule(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>()
    for (const def of context.getDocument().definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION)
        fragments.set(def.name.value, def)
    }
    return {
      OperationDefinition(node) {
        const depth = depthOf(node.selectionSet, fragments, new Set())
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(
              `Query depth ${depth} exceeds the limit of ${maxDepth}.`,
              {
                nodes: [node],
                extensions: { code: 'QUERY_TOO_DEEP' },
              },
            ),
          )
        }
      },
    }
  }
}

/** Public-API limits: query depth and query text size. */
export function limitsPlugin(
  opts: { maxDepth?: number; maxChars?: number } = {},
): Plugin {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH
  const maxChars = opts.maxChars ?? MAX_QUERY_CHARS
  return {
    onParams({ params, setResult }) {
      if (params.query && params.query.length > maxChars) {
        setResult({
          errors: [
            new GraphQLError(`Query is longer than ${maxChars} characters.`, {
              extensions: { code: 'QUERY_TOO_LARGE' },
            }),
          ],
        })
      }
    },
    onValidate({ addValidationRule }) {
      addValidationRule(depthRule(maxDepth))
    },
  }
}
