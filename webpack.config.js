const webpack = require("webpack");
const path = require("path");
const fileSystem = require("fs");
const env = require("./utils/env");
const ProgressPlugin = require("webpack/lib/ProgressPlugin");
const CleanWebpackPlugin = require("clean-webpack-plugin");
const ConcatPlugin = require("webpack-concat-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const HtmlWebpackIncludeAssetsPlugin = require("html-webpack-include-assets-plugin");
const WriteFilePlugin = require("write-file-webpack-plugin");

let alias = {};
const secretsPath = path.join(__dirname, `secrets.${env.NODE_ENV}.js`);
const fileExtensions = ["jpg", "jpeg", "png", "gif", "eot", "otf","svg", "ttf", "woff", "woff2"];

if (fileSystem.existsSync(secretsPath)){
    alias["secret"] = secretsPath;
}

const options = {
    mode: "none",
    entry: {
        popup: path.join(__dirname, "src", "app", "app.js")
    },
    output: {
        path: path.join(__dirname, "build"),
        filename: "[name].bundle.js"
    },
    module: {
        rules: [
            {
                test: /\.css$/,
                loader: "style-loader!css-loader"
            },
            {
                test: new RegExp('\.(' + fileExtensions.join('|') + ')$'),
                loader: "file-loader?name=[name].[ext]",
                exclude: /node_modules/
            },
            {
                test: /\.html$/,
                loader: "html-loader",
                exclude: /node_modules/
            }
        ]
    },
    resolve: {
        alias: alias
    },
    plugins: [
        new ProgressPlugin(),
        new CleanWebpackPlugin(["build"]),
        new webpack.DefinePlugin({
            "process.env.NODE_ENV": JSON.stringify(env.NODE_ENV)
        }),
        new ConcatPlugin({
            name: "popup-scripts",
            fileName: "[name].bundle.js",
            filesToConcat: [
                "jquery/dist/jquery.min.js",
                "jquery-ui-dist/jquery-ui.min.js"
            ]
        }),
        new CopyWebpackPlugin([{
            from: "manifest.json",
            transform: function(content, path) {
                return Buffer.from(JSON.stringify({
                    description: process.env.npm_package_description,
                    version: process.env.npm_package_version,
                    ...JSON.parse(content.toString())
                }))
            }
        },
        {
            from: "content/**/*"
        }]),
        new HtmlWebpackPlugin({
            template: path.join(__dirname, "src", "index.html"),
            filename: "index.html"
        }),
        new HtmlWebpackIncludeAssetsPlugin({
            assets: ["popup-scripts.bundle.js"],
            append: false
        }),
        new WriteFilePlugin()
    ],
    performance: {
        hints: false
    }
};

if (env.NODE_ENV === "development" || env.NODE_ENV === "dev") {
    options.devtool = "cheap-module-eval-source-map";
}

module.exports = options;