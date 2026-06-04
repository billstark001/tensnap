# Guide Policy Checkpoints

Place trained DQN guide checkpoints (`.pt` or `.pth`) in this directory.

`evac_viz.py` scans this directory at startup and exposes the file names through
the TenSnap `Guide Model` parameter. The built-in reset action and the
`Reset Guide Model` action reload the currently selected checkpoint.
