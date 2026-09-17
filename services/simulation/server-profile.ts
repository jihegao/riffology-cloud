/** Fixed native environment. Source lock remains the shared six-package contract. */
export const MESA_SERVER_PROFILE = {
  "profileId": "mesa-3.5.1-cpython-3.14.2/v1",
  "pythonVersion": "3.14.2",
  "platform": "linux/amd64",
  "interpreterSha256": "4eb8731e2dbc9644dca24e71a9e7615f7fb04720342ea65f3c30ea3a6a00b792",
  "interpreterUrl": "https://github.com/astral-sh/python-build-standalone/releases/download/20251217/cpython-3.14.2%2B20251217-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz",
  "sourcePackages": {
    "mesa": "3.5.1",
    "networkx": "3.6.1",
    "numpy": "2.4.6",
    "pandas": "3.0.2",
    "scipy": "1.18.0",
    "tqdm": "4.67.3"
  },
  "dependencies": [
    {
      "name": "mesa",
      "version": "3.5.1",
      "sha256": "528f14add1b13f86f4780cf2cf067aea019885b2628720e352447cd0571234f7",
      "filename": "mesa-3.5.1-py3-none-any.whl"
    },
    {
      "name": "networkx",
      "version": "3.6.1",
      "sha256": "d47fbf302e7d9cbbb9e2555a0d267983d2aa476bac30e90dfbe5669bd57f3762",
      "filename": "networkx-3.6.1-py3-none-any.whl"
    },
    {
      "name": "numpy",
      "version": "2.4.6",
      "sha256": "a2c306dea656c12c68f51f4cea133cbe78ca7435eb28c735eac1d3ebe73be6e8",
      "filename": "numpy-2.4.6-cp314-cp314-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl"
    },
    {
      "name": "pandas",
      "version": "3.0.2",
      "sha256": "deeca1b5a931fdf0c2212c8a659ade6d3b1edc21f0914ce71ef24456ca7a6535",
      "filename": "pandas-3.0.2-cp314-cp314-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl"
    },
    {
      "name": "python-dateutil",
      "version": "2.9.0.post0",
      "sha256": "a8b2bc7bffae282281c8140a97d3aa9c14da0b136dfe83f850eea9a5f7470427",
      "filename": "python_dateutil-2.9.0.post0-py2.py3-none-any.whl"
    },
    {
      "name": "scipy",
      "version": "1.18.0",
      "sha256": "8ca01e8ae69f1b18e9a58d91afead31be3cef0dd905a10249dac559ee15460a0",
      "filename": "scipy-1.18.0-cp314-cp314-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl"
    },
    {
      "name": "six",
      "version": "1.17.0",
      "sha256": "4721f391ed90541fddacab5acf947aa0d3dc7d27b2e1e8eda2be8970586c3274",
      "filename": "six-1.17.0-py2.py3-none-any.whl"
    },
    {
      "name": "tqdm",
      "version": "4.67.3",
      "sha256": "ee1e4c0e59148062281c49d80b25b67771a127c85fc9676d3be5f243206826bf",
      "filename": "tqdm-4.67.3-py3-none-any.whl"
    }
  ]
} as const;
export const MESA_SOURCE_PACKAGES:Record<string,string> = MESA_SERVER_PROFILE.sourcePackages;
export function mesaSourcePackages(raw:Record<string,unknown>){return Object.keys(raw).length===Object.keys(MESA_SOURCE_PACKAGES).length&&Object.entries(MESA_SOURCE_PACKAGES).every(([name,version])=>raw[name]===version);}
