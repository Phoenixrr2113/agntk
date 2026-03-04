import { describe, it, expect } from 'vitest';
import { createToolPreset, toolPresets } from '../presets/tools';

describe('Tool Presets', () => {
  describe('toolPresets constants', () => {
    it('should have none preset as empty', () => {
      expect(toolPresets.none).toEqual({});
    });

    it('should have minimal preset definition', () => {
      expect(toolPresets.minimal.description).toContain('Glob');
      expect(toolPresets.minimal.tools).toContain('glob');
    });

    it('should have standard preset definition', () => {
      expect(toolPresets.standard.tools).toContain('glob');
      expect(toolPresets.standard.tools).toContain('grep');
      expect(toolPresets.standard.tools).toContain('shell');
      expect(toolPresets.standard.tools).toContain('plan');
      expect(toolPresets.standard.tools).toContain('deep_reasoning');
    });

    it('should have full preset definition', () => {
      expect(toolPresets.full.tools).toContain('ast_grep_search');
    });
  });

  describe('createToolPreset', () => {
    it('should create none preset as empty object', () => {
      const tools = createToolPreset('none');
      expect(Object.keys(tools)).toHaveLength(0);
    });

    it('should create minimal preset with glob tool', () => {
      const tools = createToolPreset('minimal', {
        workspaceRoot: '/tmp',
      });

      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeUndefined();
    });

    it('should create standard preset with all core tools', () => {
      const tools = createToolPreset('standard', {
        workspaceRoot: '/tmp',
      });

      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
      expect(tools.shell).toBeDefined();
      expect(tools.plan).toBeDefined();
      expect(tools.deep_reasoning).toBeDefined();
    });

    it('should create full preset with ast-grep', () => {
      const tools = createToolPreset('full', {
        workspaceRoot: '/tmp',
      });

      expect(tools.glob).toBeDefined();
      expect(tools.grep).toBeDefined();
      expect(tools.shell).toBeDefined();
      expect(tools.ast_grep_search).toBeDefined();
    });

    it('should include custom tools', () => {
      const customTool = { description: 'Custom', execute: () => 'ok' };

      const tools = createToolPreset('none', {
        customTools: { myTool: customTool },
      });

      expect(tools.myTool).toBe(customTool);
    });

    it('should throw for unknown preset', () => {
      expect(() => createToolPreset('invalid' as never)).toThrow('Unknown tool preset');
    });
  });
});
