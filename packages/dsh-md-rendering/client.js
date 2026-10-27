window.__ModuleLoader__.load({
  id: 'dsh-md-rendering',
  factory(require) {
    const React = require('react');
    const css = `
      [data-chat-flow-kind="assistant-step"] div:has(> table),
      [data-chat-flow-kind="assistant-step"] div.md-table-wide:hover,
      [data-chat-flow-kind="assistant-step"] div.md-table-wide:focus-visible {
        max-width: 100%;
        overflow-x: auto;
        padding-bottom: 0;
      }
      [data-chat-flow-kind="assistant-step"] div.md-table-wide {
        width: 100%;
        max-width: 100%;
        margin-left: 0;
        padding-left: 0;
        overflow-x: auto;
      }
      [data-chat-flow-kind="assistant-step"] div > table {
        width: 100%;
        max-width: none;
        border-collapse: collapse;
        margin: 0 0 1.1em;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: .85rem;
        line-height: normal;
        overflow-wrap: normal;
        word-break: normal;
      }
      [data-chat-flow-kind="assistant-step"] div > table th,
      [data-chat-flow-kind="assistant-step"] div > table td,
      [data-chat-flow-kind="assistant-step"] div > table th:first-child,
      [data-chat-flow-kind="assistant-step"] div > table td:first-child,
      [data-chat-flow-kind="assistant-step"] div > table th:last-child,
      [data-chat-flow-kind="assistant-step"] div > table td:last-child {
        min-width: 0;
        max-width: none;
        border: 1px solid var(--dsw-alias-border-l2);
        background: var(--dsw-alias-bg-base);
        color: inherit;
        padding: .45em .8em;
        text-align: left !important;
      }
      [data-chat-flow-kind="assistant-step"] div > table th {
        font-weight: 600;
      }
      [data-chat-flow-kind="assistant-step"] div > table code {
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-brand-primary);
        padding: .15em .45em;
        border-radius: 4px;
        font-size: .82em;
        font-family: "SF Mono", "Fira Code", "Cascadia Code", "JetBrains Mono", Menlo, monospace;
      }
    `;
    function TableStyles() {
      return React.createElement('style', { 'data-dsh-md-rendering': '' }, css);
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'dsh-md-rendering-table-styles',
        }, TableStyles));
      },
    };
  },
});
