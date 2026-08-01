import type { Command } from '../command';

/**
 * Parse a CLI flag string (e.g. "--prompt <text>", "--stream") into
 * a parameter name and inferred type.
 */
function parseFlag(flag: string): {
  name: string;
  kebabName: string;
  inferredType: string;
  isArray: boolean;
} {
  // e.g. "--prompt <text>" -> "prompt"
  const match = flag.match(/^--([a-zA-Z0-9-]+)/);
  const kebabName = match ? match[1]! : '';
  // camelCase to match internal API conventions
  const name = kebabName.replace(/-([a-zA-Z0-9])/g, (_, c: string) => c.toUpperCase());

  let inferredType = 'string';
  let isArray = false;

  if (!flag.includes('<') && !flag.includes('[')) {
    // No parameter value — typically a boolean flag like --stream
    inferredType = 'boolean';
  } else if (flag.includes('<n>') || flag.includes('<hz>') || flag.includes('<bps>') || flag.includes('<count>')) {
    inferredType = 'number';
  }

  if (flag.toLowerCase().includes('repeatable')) {
    isArray = true;
  }

  return { name, kebabName, inferredType, isArray };
}

export function generateToolSchema(cmd: Command): Record<string, unknown> {
  const toolName = `mmx_${cmd.name.replace(/ /g, '_')}`;

  const schema: Record<string, unknown> = {
    name: toolName,
    description: cmd.description,
    input_schema: {
      type: 'object',
      properties: {} as Record<string, unknown>,
      required: [] as string[],
    },
  };

  if (cmd.options) {
    for (const opt of cmd.options) {
      if (opt.hidden) continue;
      const { name, inferredType, isArray } = parseFlag(opt.flag);
      if (!name) continue;

      // Explicit type from OptionDef takes precedence; fall back to inference
      const explicitType = opt.type;
      const effectiveType = isArray
        ? 'array'
        : (explicitType ?? inferredType);

      const propSchema: Record<string, unknown> = { description: opt.description };

      if (effectiveType === 'array') {
        propSchema.type = 'array';
        propSchema.items = { type: 'string' };
      } else {
        propSchema.type = effectiveType;
      }

      const inputSchema = schema.input_schema as Record<string, unknown>;
      (inputSchema.properties as Record<string, unknown>)[name] = propSchema;

      if (opt.required) {
        (inputSchema.required as string[]).push(name);
      }
    }
  }

  return schema;
}
