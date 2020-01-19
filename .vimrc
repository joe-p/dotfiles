python3 from powerline.vim import setup as powerline_setup
python3 powerline_setup()
python3 del powerline_setup
set laststatus=2 " Always display the statusline in all windows
set showtabline=2 " Always display the tabline, even if there is only one tab
set noshowmode " Hide the default mode text (e.g. -- INSERT -- below the statusline)
set t_Co=256
set updatetime=100

set tabstop=2 shiftwidth=2 expandtab
set undofile
set backupdir=~/.vim/backups
set directory=~/.vim/swaps
set undodir=~/.vim/undo


syntax enable

" Plugins will be downloaded under the specified directory.
call plug#begin('~/.vim/plugged')

" Declare the list of plugins.

Plug 'vim-airline/vim-airline'
Plug 'scrooloose/nerdtree'
Plug 'Xuyuanp/nerdtree-git-plugin'
Plug 'airblade/vim-gitgutter'
Plug 'yggdroot/indentline'
Plug 'elixir-lang/vim-elixir'


" List ends here. Plugins become visible to Vim after this call.
call plug#end()
