"""Built-in algorithms. Each file is a self-contained `class Model` that imports common libraries, never upliftlab.

The files here use EconML (PyWhy) and run in the local edition. The browser has no EconML, so the web runs the files in
lite/: the same methods written with scikit-learn only. Random has no lite version because it needs neither.
The screen shows and runs these exact files."""
ORDER = ['random_baseline', 'x_learner', 't_learner', 'r_learner', 'dml', 'duality_r_learner']
