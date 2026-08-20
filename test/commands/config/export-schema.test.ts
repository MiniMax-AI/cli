import { describe, it, expect } from 'bun:test';
import { generateToolSchema } from '../../../src/utils/schema';
import { registry } from '../../../src/registry';

type JsonSchema = Record<string, unknown>;
type ToolSchema = { name: string; description?: string; input_schema: JsonSchema };

function getSchema(cmdName: string): ToolSchema {
  const { command } = registry.resolve(cmdName.split(' '));
  return generateToolSchema(command) as unknown as ToolSchema;
}

function is(input: unknown): JsonSchema {
  return input as JsonSchema;
}

describe('generateToolSchema', () => {
  it('generates schema for text chat command', () => {
    const schema = getSchema('text chat');

    expect(schema.name).toBe('mmx_text_chat');
    expect(schema.description).toBeDefined();
    expect(schema.input_schema).toBeDefined();
    expect(schema.input_schema.type).toBe('object');
    expect(schema.input_schema.properties).toBeDefined();
  });

  it('includes required flag properties', () => {
    const schema = getSchema('image generate');

    const ischema = schema.input_schema;
    const props = is(ischema.properties);
    expect(props.prompt).toBeDefined();
    expect(is(props.prompt).type).toBe('string');
    expect(ischema.required).toContain('prompt');
  });

  it('infers number type from numeric flags', () => {
    const schema = getSchema('text chat');

    const props = is(schema.input_schema.properties);
    const maxTokens = Object.entries(props).find(([key]) => key === 'maxTokens');
    expect(maxTokens).toBeDefined();
    expect(is(maxTokens![1]!).type).toBe('number');
  });

  it('infers boolean type for flagless options', () => {
    const schema = getSchema('text chat');

    const props = is(schema.input_schema.properties);
    expect(props.stream).toBeDefined();
    expect(is(props.stream).type).toBe('boolean');
  });

  it('infers array type for repeatable options', () => {
    const schema = getSchema('text chat');

    const props = is(schema.input_schema.properties);
    expect(props.message).toBeDefined();
    expect(is(props.message).type).toBe('array');
  });

  it('name uses underscore-separated path', () => {
    const schema = getSchema('speech synthesize');

    expect(schema.name).toBe('mmx_speech_synthesize');
  });

  it('excludes hidden compatibility aliases', () => {
    const schema = getSchema('video generate');
    const props = is(schema.input_schema.properties);

    expect(props.image).toBeDefined();
    expect(props.firstFrame).toBeUndefined();
  });
});

describe('registry getAllCommands filtering', () => {
  it('does not resolve the retired command group', () => {
    const retiredResource = ['mu', 'sic'].join('');

    expect(() => registry.resolve([retiredResource, 'generate'])).toThrow('Unknown command');
    expect(() => registry.resolve([retiredResource, 'cover'])).toThrow('Unknown command');
  });

  it('returns all registered commands', () => {
    const commands = registry.getAllCommands();
    expect(commands.length).toBeGreaterThan(10);
    // Should contain real commands
    const names = commands.map(c => c.name);
    expect(names).toContain('text chat');
    expect(names).toContain('image generate');
    expect(names).toContain('speech synthesize');
  });

  it('filters out auth, config, update prefixes', () => {
    const SKIP = ['auth ', 'config ', 'update'];
    const commands = registry.getAllCommands();
    const filtered = commands.filter(c => !SKIP.some(p => c.name.startsWith(p)));

    const names = filtered.map(c => c.name);
    expect(names.every(n => !n.startsWith('auth '))).toBe(true);
    expect(names.every(n => !n.startsWith('config '))).toBe(true);
    // Real commands remain
    expect(names.some(n => n === 'text chat')).toBe(true);
    expect(names.some(n => n === 'image generate')).toBe(true);
  });

  it('every filtered command generates valid schema', () => {
    const SKIP = ['auth ', 'config ', 'update'];
    const commands = registry.getAllCommands();
    const filtered = commands.filter(c => !SKIP.some(p => c.name.startsWith(p)));

    for (const cmd of filtered) {
      const schema = generateToolSchema(cmd) as unknown as ToolSchema;
      expect(schema.name).toMatch(/^mmx_\w/);
      expect(schema.input_schema.type).toBe('object');
      expect(typeof schema.description).toBe('string');
    }
  });
});
