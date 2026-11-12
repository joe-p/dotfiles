vim.pack.add {
  { src = 'https://github.com/MunifTanjim/nui.nvim' },
  { src = 'https://github.com/esmuellert/codediff.nvim' },
}

require('codediff').setup {
  diff = {
    layout = 'inline', -- "side-by-side" (default) or "inline"
  },
  explorer = {
    view_mode = 'tree',
  },
  keymaps = {
    view = {
      next_hunk = ']g',
      prev_hunk = '[g',
    },
  },
}
