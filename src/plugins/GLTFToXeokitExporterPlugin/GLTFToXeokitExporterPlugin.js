import {math} from "../../viewer/scene/math/math.js";
import {utils} from "../../viewer/scene/utils.js";
import {GLTFPerformanceLoader} from "../GLTFLoaderPlugin/GLTFPerformanceLoader.js";
import {buildEdgeIndices} from '../../viewer/scene/math/buildEdgeIndices.js';
import {transformAndOctEncodeNormals,quantizePositions} from '../../viewer/scene/PerformanceModel/lib/batching/batchingLayer.js';

const tempMat4 = math.mat4();
const tempMat4b = math.mat4();
const tempVec3a = math.vec4([0, 0, 0, 1]);
const tempVec3b = math.vec4([0, 0, 0, 1]);

const defaultScale = math.vec3([1, 1, 1]);
const defaultPosition = math.vec3([0, 0, 0]);
const defaultRotation = math.vec3([0, 0, 0]);
const defaultQuaternion = math.identityQuaternion();

class FakePerformanceModel {

    constructor(plugin) {
        this.plugin = plugin;
        this.meshes = [];
        this.entities = [];
        this.geometries = [];

        this.scene = {
            fire: function () {},
        }
    }

    // Start of mocked methods
    createEntity(entityCfg) {
        this.entities.push(entityCfg);
    }

    createGeometry(geometryCfg) {
        this.geometries [geometryCfg.id] = geometryCfg;
    }

    createMesh(geometryCfg) {
        var geometryId = geometryCfg.geometryId;

        if (geometryId !== undefined) {
            var meshId = geometryCfg.id;
            var color = geometryCfg.color;
            var matrix = geometryCfg.matrix;
            var opacity = geometryCfg.opacity;

            geometryCfg = this.clone (this.geometries [geometryId]);
            geometryCfg.id = meshId;
            geometryCfg.color = color.slice();
            geometryCfg.matrix = matrix.slice();
            geometryCfg.opacity = opacity;
        }

        this.meshes.push(geometryCfg);
    }

    createTile(params) {
    }

    error(msg) {
    }

    finalize() {
    }

    finalizeTile() {
    }

    fire(eventName) {
    }
    // End of mocked methods
    
    clone(obj) {
        var copy;

        // Handle the 3 simple types, and null or undefined
        //if (null == obj || "object" != typeof obj) return obj;
        if (typeof obj === "string") {
            return obj;
        }

        // Handle Date
        if (obj instanceof Date) {
            copy = new Date();
            copy.setTime(obj.getTime());
            return copy;
        }

        // Handle Array
        if (obj instanceof Array) {
            copy = [];
            for (var i = 0, len = obj.length; i < len; i++) {
                copy[i] = clone(obj[i]);
            }
            return copy;
        }

        if (obj instanceof Int8Array ||
            obj instanceof Uint8Array ||
            obj instanceof Uint8ClampedArray ||
            obj instanceof Int16Array ||
            obj instanceof Uint16Array ||
            obj instanceof Int32Array ||
            obj instanceof Uint32Array ||
            obj instanceof Float32Array ||
            obj instanceof Float64Array) {
            return obj.slice ();
        }

        // Handle Object
        if (obj instanceof Object) {
            copy = {};
            for (var attr in obj) {
                //console.log (attr);
                if (obj.hasOwnProperty(attr)) copy[attr] = this.clone(obj[attr]);
            }
            return copy;
        }

        throw new Error("Unable to copy obj! Its type isn't supported.");
    }
}

class GLTFToXeokitExporterPlugin {

    /**
     * @constructor
     *
     * @param {Viewer} viewer The Viewer.
     * @param {Object} cfg  Plugin configuration.
     * @param {String} [cfg.id="GLTFToXeokitExporter"] Optional ID for this plugin, so that we can find it within {@link Viewer#plugins}.
     * @param {Object} [cfg.objectDefaults] Map of initial default states for each loaded {@link Entity} that represents an object.  Default value is {@link IFCObjectDefaults}.
     */
    constructor(viewer, cfg = {}) {
        //super("GLTFToXeokitExporter", viewer, cfg);

        /**
         * @private
         */
    }

    error(str) {
        console.log ("error: " + str);
    }

    load(params = {}) {

        this.viewer = {
            scene: {
                fire: function () {},
                canvas: {
                    spinner: {
                        processes: 0,
                    }
                }
            }

        };
        const self = this;
        
        this._glTFPerformanceLoader = new GLTFPerformanceLoader(this, {});

        const model = new FakePerformanceModel(this);

        const modelId = model.id;  // In case ID was auto-generated

        if (!params.src && !params.gltf) {
            this.error("load() param expected: src or gltf");
            return model; // Return new empty model
        }

        const loader = this._glTFPerformanceLoader;

        params.handleGLTFNode = function (modelId, glTFNode, actions) {

            const name = glTFNode.name;

            if (!name) {
                return true; // Continue descending this node subtree
            }

            const id = name;

            actions.createEntity = { // Create an Entity for this glTF scene node
                id: id,
                isObject: true // Registers the Entity in Scene#objects
            };

            return true; // Continue descending this glTF node subtree
        };

        var processFakeModel = function () {
            if (params.xeokitArrayBufferGenerated) {
                self._startPostProcessing(model);
                params.xeokitArrayBufferGenerated(model.arrayBuffer);
            }
        };

        if (params.src) {
            loader.load(self, model, params.src, params, processFakeModel);
        } else {
            loader.parse(self, model, params.gltf, processFakeModel);
        }
    }

    _startPostProcessing (fakeModel) {
        //console.log("Number of meshes in FakePerformanceModel: " + fakeModel.meshes.length);
        //console.log("Number of entities in FakePerformanceModel: " + fakeModel.entities.length);

        // a) process meshes in order to transform and quantize positions

        // a.1) transform positions and calculate global bounding box
        var globalAABB = math.collapseAABB3();

        for (var i = 0, len1 = fakeModel.meshes.length; i < len1; i++) {
            var geometryCfg = fakeModel.meshes [i];

            var aabb = math.collapseAABB3();
            var matrix = geometryCfg.matrix;
            var transformedPositions = geometryCfg.positions.slice();

            if (matrix) {
                for (var j = 0, len2 = transformedPositions.length; j < len2; j += 3) {
                    tempVec3a[0] = transformedPositions[j + 0];
                    tempVec3a[1] = transformedPositions[j + 1];
                    tempVec3a[2] = transformedPositions[j + 2];
                    math.transformPoint4(matrix, tempVec3a, tempVec3b);
                    math.expandAABB3Point3(aabb, tempVec3b); // Expand portion AABB
                    transformedPositions[j + 0] = tempVec3b[0];
                    transformedPositions[j + 1] = tempVec3b[1];
                    transformedPositions[j + 2] = tempVec3b[2];
                }
            } else {
                for (var j = 0, len2 = transformedPositions.length; j < len2; j += 3) {
                    tempVec3a[0] = transformedPositions[j + 0];
                    tempVec3a[1] = transformedPositions[j + 1];
                    tempVec3a[2] = transformedPositions[j + 2];
                    math.expandAABB3Point3(aabb, tempVec3a);
                }
            }

            math.expandAABB3 (globalAABB, aabb);

            geometryCfg.positions = transformedPositions;
            geometryCfg.aabb = aabb;
        }

        // a.2) quantize positions and generate matrix to decode them
        var positionsDecodeMatrix = math.mat4();

        for (var i = 0, len = fakeModel.meshes.length; i < len; i++) {
            var geometryCfg = fakeModel.meshes [i];

            geometryCfg.quantizedPositions = new Uint16Array(geometryCfg.positions.length);

            quantizePositions(geometryCfg.positions, geometryCfg.positions.length, globalAABB, geometryCfg.quantizedPositions, positionsDecodeMatrix);
        }

        // b) encode normals
        for (var i = 0, len = fakeModel.meshes.length; i < len; i++) {
            var geometryCfg = fakeModel.meshes [i];

            var matrix = geometryCfg.matrix;

            var modelNormalMatrix = tempMat4;
            if (matrix) {
                // Note: order of inverse and transpose doesn't matter
                math.inverseMat4(math.transposeMat4(matrix, tempMat4b), modelNormalMatrix);
            } else {
                math.identityMat4(modelNormalMatrix, modelNormalMatrix);
            }

            geometryCfg.encodedNormals = new Int8Array(geometryCfg.normals.length);

            transformAndOctEncodeNormals(modelNormalMatrix, geometryCfg.normals, geometryCfg.normals.length, geometryCfg.encodedNormals, 0);
        }

        // c) simplify id's for geometries and entities

        // c.1) generate the new simplified mesh ids
        var newMeshIds = {};

        for (var i = 0, len = fakeModel.meshes.length, totalNumMeshes = 0; i < len; i++, totalNumMeshes++) {
            var geometryCfg = fakeModel.meshes [i];

            newMeshIds [geometryCfg.id] = totalNumMeshes;
        }

        // c.2) remap entities' mesh ids
        for (var i = 0, len = fakeModel.entities.length; i < len; i++) {
            var entity = fakeModel.entities [i];

            entity.meshIds = entity.meshIds.map(function(oldId) {
                return newMeshIds [oldId];
            });
        }
        
        // d) compress the resulting meshes and entities
        var compressedData = this._compressGeometry(fakeModel.entities, fakeModel.meshes, positionsDecodeMatrix);
        
        // e) generate a arrayBuffer with the compressed data
        var arrayBuffer = this._generateArrayBufferWithCompressedData(compressedData);

        fakeModel.arrayBuffer = arrayBuffer;
    }

    _compressGeometry(entities, meshes, positionsDecodeMatrix) {
        //console.time('compressGeometry');

        var serializedMeshesCounters = {
            countAllColors: 0,
            countAllEdgeIndices: 0,
            countAllIndices: 0,
            countAllMatrices: 0,
            countAllAABB: 0,
            countAllEncodedNormals: 0,
            countAllOpacities: 0,
            countAllQuantizedPositions: 0,
        };

        var countMeshes = 0;
        var countEntities = 0;

        for (let i = 0, len = meshes.length; i < len; i++) {
            var mesh = meshes [i];

            serializedMeshesCounters.countAllColors += mesh.color.length;
            serializedMeshesCounters.countAllEdgeIndices += mesh.edgeIndices.length;
            serializedMeshesCounters.countAllIndices += mesh.indices.length;
            serializedMeshesCounters.countAllMatrices += mesh.matrix.length;
            serializedMeshesCounters.countAllEncodedNormals += mesh.encodedNormals.length;
            serializedMeshesCounters.countAllOpacities++;
            serializedMeshesCounters.countAllQuantizedPositions += mesh.quantizedPositions.length;
            serializedMeshesCounters.countAllAABB += mesh.aabb.length;

            countMeshes++;
        }

        var allMeshesData = {
            allColors: new Float32Array (serializedMeshesCounters.countAllColors),
            allEdgeIndices: new Uint16Array (serializedMeshesCounters.countAllEdgeIndices),
            allIndices: new Uint16Array (serializedMeshesCounters.countAllIndices),
            allMatrices: new Float32Array (serializedMeshesCounters.countAllMatrices),
            allEncodedNormals: new Int8Array (serializedMeshesCounters.countAllEncodedNormals),
            allOpacities: new Float32Array (serializedMeshesCounters.countAllOpacities),
            allQuantizedPositions: new Uint16Array (serializedMeshesCounters.countAllQuantizedPositions),
            allAABB: new Float32Array (serializedMeshesCounters.countAllAABB),
        };

        var allEntitiesData = {
            allMeshesIdsForCompress: new Uint32Array (countMeshes),
            allIsObject: new Uint8Array (entities.length),
            allIds: [],
        };

        var serializedMeshesCounters = {
            countAllColors: 0,
            countAllEdgeIndices: 0,
            countAllIndices: 0,
            countAllMatrices: 0,
            countAllEncodedNormals: 0,
            countAllOpacities: 0,
            countAllQuantizedPositions: 0,
            countAllAABB: 0,
        };

        var positionsInAllMeshesData = {
            positionColors: new Uint32Array (countMeshes),
            positionEdgeIndices: new Uint32Array (countMeshes),
            positionIndices: new Uint32Array (countMeshes),
            positionMatrices: new Uint32Array (countMeshes),
            positionEncodedNormals: new Uint32Array (countMeshes),
            positionOpacities: new Uint32Array (countMeshes),
            positionQuantizedPositions: new Uint32Array (countMeshes),
            positionAABB: new Uint32Array (countMeshes),
        };

        var positionsInAllEntitiesData = {
            positionMeshes: new Uint32Array (entities.length),
        };

        var countEntities = 0;
        var countEntitiesMeshes = 0;

        for (let i = 0, len = entities.length; i < len; i++) {
            var entity = entities [i];

            allEntitiesData.allMeshesIdsForCompress.set(entity.meshIds, countEntitiesMeshes);
            allEntitiesData.allIds [countEntities] = entity.id;
            allEntitiesData.allIsObject [countEntities] = entity.isObject ? 1 : 0,

            positionsInAllEntitiesData.positionMeshes [countEntities] = countEntitiesMeshes;

            countEntities++;
            countEntitiesMeshes += entity.meshIds.length;
        }

        var countMeshes = 0;

        for (let j = 0, len2 = meshes.length; j < len2; j++) {
            var mesh = meshes [j];

            allMeshesData.allColors.set(mesh.color, serializedMeshesCounters.countAllColors);
            allMeshesData.allEdgeIndices.set(mesh.edgeIndices, serializedMeshesCounters.countAllEdgeIndices);
            allMeshesData.allIndices.set(mesh.indices, serializedMeshesCounters.countAllIndices);
            allMeshesData.allMatrices.set(mesh.matrix, serializedMeshesCounters.countAllMatrices);
            allMeshesData.allEncodedNormals.set(mesh.encodedNormals, serializedMeshesCounters.countAllEncodedNormals);
            allMeshesData.allOpacities [serializedMeshesCounters.countAllOpacities] = mesh.opacity;
            allMeshesData.allQuantizedPositions.set(mesh.quantizedPositions, serializedMeshesCounters.countAllQuantizedPositions);
            allMeshesData.allAABB.set(mesh.aabb, serializedMeshesCounters.countAllAABB);

            positionsInAllMeshesData.positionColors [countMeshes] = serializedMeshesCounters.countAllColors;
            positionsInAllMeshesData.positionEdgeIndices [countMeshes] = serializedMeshesCounters.countAllEdgeIndices;
            positionsInAllMeshesData.positionIndices [countMeshes] = serializedMeshesCounters.countAllIndices;
            positionsInAllMeshesData.positionMatrices [countMeshes] = serializedMeshesCounters.countAllMatrices;
            positionsInAllMeshesData.positionEncodedNormals [countMeshes] = serializedMeshesCounters.countAllEncodedNormals;
            positionsInAllMeshesData.positionOpacities [countMeshes] = serializedMeshesCounters.countAllOpacities
            positionsInAllMeshesData.positionQuantizedPositions [countMeshes] = serializedMeshesCounters.countAllQuantizedPositions;
            positionsInAllMeshesData.positionAABB [countMeshes] = serializedMeshesCounters.countAllAABB;

            serializedMeshesCounters.countAllColors += mesh.color.length;
            serializedMeshesCounters.countAllEdgeIndices += mesh.edgeIndices.length;
            serializedMeshesCounters.countAllIndices += mesh.indices.length;
            serializedMeshesCounters.countAllMatrices += mesh.matrix.length;
            serializedMeshesCounters.countAllEncodedNormals += mesh.encodedNormals.length;
            serializedMeshesCounters.countAllOpacities++;
            serializedMeshesCounters.countAllQuantizedPositions += mesh.quantizedPositions.length;
            serializedMeshesCounters.countAllAABB += mesh.aabb.length;

            countMeshes++;
        }

        var compressedData = {
            meshes: {
                allColors: pako.deflate(allMeshesData.allColors.buffer),
                allEdgeIndices: pako.deflate(allMeshesData.allEdgeIndices.buffer),
                allIndices: pako.deflate(allMeshesData.allIndices.buffer),
                allMatrices: pako.deflate(allMeshesData.allMatrices.buffer),
                allEncodedNormals: pako.deflate(allMeshesData.allEncodedNormals.buffer),
                allOpacities: pako.deflate(allMeshesData.allOpacities.buffer),
                allQuantizedPositions: pako.deflate(allMeshesData.allQuantizedPositions.buffer),
                allAABB: pako.deflate(allMeshesData.allAABB.buffer),

                positionColors: pako.deflate(positionsInAllMeshesData.positionColors.buffer),
                positionEdgeIndices: pako.deflate(positionsInAllMeshesData.positionEdgeIndices.buffer),
                positionIndices: pako.deflate(positionsInAllMeshesData.positionIndices.buffer),
                positionMatrices: pako.deflate(positionsInAllMeshesData.positionMatrices.buffer),
                positionEncodedNormals: pako.deflate(positionsInAllMeshesData.positionEncodedNormals.buffer),
                positionOpacities: pako.deflate(positionsInAllMeshesData.positionOpacities.buffer),
                positionQuantizedPositions: pako.deflate(positionsInAllMeshesData.positionQuantizedPositions.buffer),
                positionAABB: pako.deflate(positionsInAllMeshesData.positionAABB.buffer),
            },
            entities: {
                allMeshesIds: pako.deflate (allEntitiesData.allMeshesIdsForCompress.buffer),
                allIds: pako.deflate (
                    JSON
                        .stringify(allEntitiesData.allIds)
                        // produce only ASCII-chars, so that the data can be inflated later
                        .replace(/[\u007F-\uFFFF]/g, function(chr) {
                            return "\\u" + ("0000" + chr.charCodeAt(0).toString(16)).substr(-4)
                        })
                ),
                allIsObject: pako.deflate(allEntitiesData.allIsObject),
                positionMeshes: pako.deflate(positionsInAllEntitiesData.positionMeshes.buffer),
            },
            positionsDecodeMatrix: pako.deflate(positionsDecodeMatrix.buffer),
        };

        var compressedSize =
            compressedData.meshes.allColors.length + 
            compressedData.meshes.allEdgeIndices.length + 
            compressedData.meshes.allIndices.length + 
            compressedData.meshes.allMatrices.length + 
            compressedData.meshes.allEncodedNormals.length + 
            compressedData.meshes.allOpacities.length + 
            compressedData.meshes.allQuantizedPositions.length + 
            compressedData.meshes.allAABB.length + 

            compressedData.meshes.positionColors.length + 
            compressedData.meshes.positionEdgeIndices.length + 
            compressedData.meshes.positionIndices.length + 
            compressedData.meshes.positionMatrices.length + 
            compressedData.meshes.positionEncodedNormals.length + 
            compressedData.meshes.positionOpacities.length + 
            compressedData.meshes.positionQuantizedPositions.length + 
            compressedData.meshes.positionAABB.length + 

            compressedData.entities.allMeshesIds.length + 
            compressedData.entities.allIds.length + 
            compressedData.entities.allIsObject.length + 
            compressedData.entities.positionMeshes.length +
            
            compressedData.positionsDecodeMatrix.buffer.byteLength; // todo: deflate

        var data = new Uint8Array(compressedSize);
        
        //console.log("compressed size = " + compressedSize + " bytes (" + (compressedSize/1024/1024).toFixed(2) + " MB)");

        //console.timeEnd('compressGeometry');

        return compressedData;
    }

    _generateArrayBufferWithCompressedData(compressedData) {
        return this._toArrayBuffer([
            compressedData.meshes.allColors,
            compressedData.meshes.allEdgeIndices,
            compressedData.meshes.allIndices,
            compressedData.meshes.allMatrices,
            compressedData.meshes.allEncodedNormals,
            compressedData.meshes.allOpacities,
            compressedData.meshes.allQuantizedPositions,
            compressedData.meshes.allAABB,
            compressedData.meshes.positionColors,
            compressedData.meshes.positionEdgeIndices,
            compressedData.meshes.positionIndices,
            compressedData.meshes.positionMatrices,
            compressedData.meshes.positionEncodedNormals,
            compressedData.meshes.positionOpacities,
            compressedData.meshes.positionQuantizedPositions,
            compressedData.meshes.positionAABB,
            compressedData.entities.allMeshesIds,
            compressedData.entities.allIds,
            compressedData.entities.allIsObject,
            compressedData.entities.positionMeshes,
            compressedData.positionsDecodeMatrix
        ]);
    }

    _toArrayBuffer(dataArr) {
        var dataItemPositions = new Uint32Array(dataArr.length+1);

        // Stored Data 1.1: number of stored items
        dataItemPositions [0] = dataArr.length;

        // Stored Data 1.2: length of stored items
        var dataLen = 0;

        for (var i = 0, len = dataArr.length; i < len; i++) {
            dataItemPositions[i+1] = dataArr[i].length;
            dataLen += dataArr[i].length;
        }

        var positions = new Uint8Array (dataItemPositions.buffer);

        var retVal = new Uint8Array (positions.length + dataLen);

        retVal.set (positions);

        var offset = positions.length;

        // Stored Data 2: the items themselves
        for (var i = 0, len = dataArr.length; i < len; i++) {
            retVal.set(dataArr[i], offset);
            offset += dataArr[i].length;
        }

        //console.log("arrayBuffer has " + arrayBuffer.length + " elements");

        console.log("arrayBuffer takes " + (retVal.length/1024).toFixed(3) + " kB");

        return retVal.buffer;
    }
}

export {GLTFToXeokitExporterPlugin}
