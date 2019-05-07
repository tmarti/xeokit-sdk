import {utils} from "../../viewer/scene/utils.js"
import {PerformanceModel} from "../../viewer/scene/PerformanceModel/PerformanceModel.js";
import {Plugin} from "../../viewer/Plugin.js";
import {core} from "../../viewer/scene/core.js";

class XeokitLoaderPlugin extends Plugin {

    constructor(viewer, cfg = {}) {
        super("XeokitLoaderPlugin", viewer, cfg);
    }

    load(params = {}) {

        const self = this;

        if (params.id && this.viewer.scene.components[params.id]) {
            this.error("Component with this ID already exists in viewer: " + params.id + " - will autogenerate this ID");
            delete params.id;
        }

        const model = new PerformanceModel(this.viewer.scene, utils.apply(params, {
            isModel: true
        }));

        if (!params.src && !params.xeokit) {
            this.error("load() param expected: src or xeokit");
            return model; // Return new empty model
        }

        const modelId = model.id;  // In case ID was auto-generated

        if (params.src) {
            this.load(self, model, params.src); // TODO: implement this one
        } else {
            core.scheduleTask (function () {
                self.parse(self, model, params.xeokit);
            });
        }

        return model;
    }

    parse(plugin, performanceModel, arrayBuffer, ok, error) {
        this.parseBlob(plugin, arrayBuffer, performanceModel, function () {
                performanceModel.scene.fire("modelLoaded", performanceModel.id); // FIXME: Assumes listeners know order of these two events
                performanceModel.fire("loaded", true, true);
                if (ok) {
                    ok();
                }
            },
            function (msg) {
                performanceModel.error(msg);
                performanceModel.fire("error", msg);
                if (error) {
                    error(msg);
                }
            });
    }

    parseBlob(plugin, arrayBuffer, performanceModel, ok, error) {
        var dataView = new DataView(arrayBuffer);
        var dataArray = new Uint8Array(arrayBuffer);

        var numElementsInBlob = dataView.getUint32(0, true);

        var readElements = [];

        for (var i = 0, totalOffset = (numElementsInBlob + 1) * 4; i < numElementsInBlob; i++) {
            var thisSize = dataView.getUint32((1+i)*4,true);
            readElements.push(dataArray.slice(totalOffset, thisSize + totalOffset));
            totalOffset+=thisSize;
        }

        var compressedData = {
            meshes: {
                allColors: readElements[0],
                allEdgeIndices: readElements[1],
                allIndices: readElements[2],
                allMatrices: readElements[3],
                allEncodedNormals: readElements[4],
                allOpacities: readElements[5],
                allQuantizedPositions: readElements[6],
                allAABB: readElements[7],

                positionColors: readElements[8],
                positionEdgeIndices: readElements[9],
                positionIndices: readElements[10],
                positionMatrices: readElements[11],
                positionEncodedNormals: readElements[12],
                positionOpacities: readElements[13],
                positionQuantizedPositions: readElements[14],
                positionAABB: readElements[15],
            },
            entities: {
                allMeshesIds: readElements[16],
                allIds: readElements[17],
                allIsObject: readElements[18],
                positionMeshes: readElements[19],
            },
            positionsDecodeMatrix: readElements[20],
        };

        this.loadCompressedData (performanceModel, compressedData);

        if (ok) {
            ok();
        }
    }

    loadCompressedData (performanceModel, compressedData) {
        //console.time('decompress');

        // Inflate data
        var decompressedData = {
            meshes: {
                allColors: pako.inflate(compressedData.meshes.allColors.buffer),
                allEdgeIndices: pako.inflate(compressedData.meshes.allEdgeIndices.buffer),
                allIndices: pako.inflate(compressedData.meshes.allIndices.buffer),
                allMatrices: pako.inflate(compressedData.meshes.allMatrices.buffer),
                allEncodedNormals: pako.inflate(compressedData.meshes.allEncodedNormals.buffer),
                allOpacities: pako.inflate(compressedData.meshes.allOpacities.buffer),
                allQuantizedPositions: pako.inflate(compressedData.meshes.allQuantizedPositions.buffer),
                allAABB: pako.inflate(compressedData.meshes.allAABB.buffer),

                positionColors: pako.inflate(compressedData.meshes.positionColors.buffer),
                positionEdgeIndices: pako.inflate(compressedData.meshes.positionEdgeIndices.buffer),
                positionIndices: pako.inflate(compressedData.meshes.positionIndices.buffer),
                positionMatrices: pako.inflate(compressedData.meshes.positionMatrices.buffer),
                positionEncodedNormals: pako.inflate(compressedData.meshes.positionEncodedNormals.buffer),
                positionOpacities: pako.inflate(compressedData.meshes.positionOpacities.buffer),
                positionQuantizedPositions: pako.inflate(compressedData.meshes.positionQuantizedPositions.buffer),
                positionAABB: pako.inflate(compressedData.meshes.positionAABB.buffer),
            },
            entities: {
                allMeshesIds: pako.inflate(compressedData.entities.allMeshesIds.buffer),
                allIds: pako.inflate(compressedData.entities.allIds, { to: 'string'} ),
                allIsObject: pako.inflate(compressedData.entities.allIsObject),

                positionMeshes: pako.inflate(compressedData.entities.positionMeshes.buffer),
            },
            positionsDecodeMatrix: pako.inflate(compressedData.positionsDecodeMatrix),
        };
        //console.timeEnd('decompress');

        this.loadDecompressedData(performanceModel, decompressedData);
    }

    loadDecompressedData (performanceModel, decompressedData) {
        //console.time('loadDecompressedData - 1');
        // Fill arrays for entities
        var _positionColors = new Uint32Array(decompressedData.meshes.positionColors.buffer);
        var _positionEdgeIndices = new Uint32Array(decompressedData.meshes.positionEdgeIndices.buffer);
        var _positionIndices = new Uint32Array(decompressedData.meshes.positionIndices.buffer);
        var _positionMatrices = new Uint32Array(decompressedData.meshes.positionMatrices.buffer);
        var _positionEncodedNormals = new Uint32Array(decompressedData.meshes.positionEncodedNormals.buffer);
        var _positionOpacities = new Uint32Array(decompressedData.meshes.positionOpacities.buffer);
        var _positionQuantizedPositions = new Uint32Array(decompressedData.meshes.positionQuantizedPositions.buffer);
        var _positionAABB = new Uint32Array(decompressedData.meshes.positionAABB.buffer);

        var _allColors = new Float32Array(decompressedData.meshes.allColors.buffer);
        var _allEdgeIndices = new Uint16Array(decompressedData.meshes.allEdgeIndices.buffer);
        var _allIndices = new Uint16Array(decompressedData.meshes.allIndices.buffer);
        var _allMatrices = new Float32Array(decompressedData.meshes.allMatrices.buffer);
        var _allEncodedNormals = new Int8Array(decompressedData.meshes.allEncodedNormals.buffer);
        var _allOpacities = new Float32Array(decompressedData.meshes.allOpacities.buffer);
        var _allQuantizedPositions = new Uint16Array(decompressedData.meshes.allQuantizedPositions.buffer);
        var _allAABB = new Float32Array(decompressedData.meshes.allAABB.buffer);

        var _positionsDecodeMatrix = new Float32Array(decompressedData.positionsDecodeMatrix.buffer);

        var numMeshes = _positionColors.length;
        //console.log("read meshes: " + numMeshes);

        var _positionMeshes = new Uint32Array(decompressedData.entities.positionMeshes.buffer);

        var numEntities = _positionMeshes.length;
        //console.log("read entities: " + numEntities);
            
        var _allMeshesIds = new Uint32Array(decompressedData.entities.allMeshesIds.buffer);
        var _allIsObject = new Uint8Array(decompressedData.entities.allIsObject.buffer);
        var _allIds = JSON.parse(decompressedData.entities.allIds);

        //console.timeEnd('loadDecompressedData - 1');

        //console.time('loadDecompressedData - 2');
        performanceModel.createTile({
            id: performanceModel.id + "_tile",
        });

        // Regenerate meshes
        for (let i = 0; i < numMeshes; i++)
        {
            var last = (i == numMeshes - 1);

            const meshCfg = {
                id: performanceModel.id + "." + i,
                tileId: performanceModel.id + "_tile",
                color: _allColors.slice (_positionColors [i], last ? _positionColors.length : _positionColors [i+1]),
                edgeIndices: _allEdgeIndices.slice (_positionEdgeIndices [i], last ? _positionEdgeIndices.length : _positionEdgeIndices [i+1]),
                indices: _allIndices.slice (_positionIndices [i], last ? _positionIndices.length : _positionIndices [i+1]),
                matrix: _allMatrices.slice (_positionMatrices [i], _positionMatrices [i] + 16),
                encodedNormals: _allEncodedNormals.slice (_positionEncodedNormals [i], last ? _positionEncodedNormals.length : _positionEncodedNormals [i+1]),
                opacity: _allOpacities [_positionOpacities [i]],
                quantizedPositions: _allQuantizedPositions.slice (_positionQuantizedPositions [i], last ? _positionQuantizedPositions.length : _positionQuantizedPositions [i+1]),
                aabb: _allAABB.slice (_positionAABB [i], _positionAABB [i] + 6),
                primitive: "triangles",
                positionsDecodeMatrix: _positionsDecodeMatrix,
                isTransformedAndEncoded: true,
                isQuantized: true,
            };

            performanceModel.createMesh(meshCfg);
        }

        // Regenerate entities
        for (let i = 0; i < numEntities; i++)
        {
            var last = (i == numEntities - 1);

            var entityMeshIds = [];

            for (let _from = _positionMeshes [i], _to = last ? _positionMeshes.length : _positionMeshes [i+1]; _from < _to; _from++)
            {
                entityMeshIds.push(performanceModel.id + "." + _from);
            }

            const entity = {
                id: _allIds [i],
                tileId: performanceModel.id + "_tile",
                isObject: _allIsObject [i] ? true : false,
                meshIds: entityMeshIds,
            };

            performanceModel.createEntity(entity);
        }

        performanceModel.finalizeTile(performanceModel.id + "_tile");

        //console.timeEnd('loadDecompressedData - 2');
    }
}

export {XeokitLoaderPlugin}
