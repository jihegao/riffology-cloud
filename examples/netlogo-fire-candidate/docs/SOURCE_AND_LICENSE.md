# Source and license

This local candidate adapts the mechanism of Uri Wilensky's 1997 **NetLogo Fire** model. The reviewed source is the model shipped with NetLogo 7.0.4:

- upstream path: `models/Sample Models/Earth Science/Fire.nlogox`
- upstream model SHA-256: `0a2420e463481fb2cd7791aacdc068735db0d900c14d3fece0a93a085246b171`
- citation: Wilensky, U. (1997). *NetLogo Fire model*. Center for Connected Learning and Computer-Based Modeling, Northwestern University, Evanston, IL.
- model information: <https://ccl.northwestern.edu/netlogo/models/Fire>
- NetLogo 7.0.4 release: <https://github.com/NetLogo/NetLogo/releases/tag/v7.0.4>

Copyright 1997 Uri Wilensky. The upstream model is licensed under [Creative Commons Attribution-NonCommercial-ShareAlike 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). This Python adaptation retains that license, attribution, noncommercial restriction, and share-alike requirement. Reimplementation does not remove the upstream conditions. No commercial permission is asserted. NetLogo runtime licensing is separate, and no NetLogo model body or runtime is copied into this directory.

The implementation was reviewed against the upstream model's setup/go order and Info description. It is source-derived, not source-equivalent: Python uses `random.Random` and fixed row-major draws, so an equal numeric seed does not identify an equal NetLogo forest.
