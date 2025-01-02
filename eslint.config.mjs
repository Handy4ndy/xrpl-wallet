import globals from "globals";
import pluginJs from "@eslint/js";
import pluginReactConfig from "eslint-plugin-react/configs/recommended.js";

const config = [
  pluginJs.configs.recommended,
  pluginReactConfig,
  {
    settings:{
      react: {
        version:"detect",
        runtime:"automatic",
      },
    },
  
    languageOptions: {
    globals: {
      ...globals.browser,
      ...globals.node,
    },

    ecmaVersion: 2021,
    sourceType: "module",
  },

  rules: {
    "react/prop-types": "off",
    "react/react-in-jsx-scope": "off",
  },
},
];

export default config;

