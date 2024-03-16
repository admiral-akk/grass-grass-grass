uniform sampler2D pTexture;

varying vec2 vUv;
// Variables described here: https://www.khronos.org/opengl/wiki/Built-in_Variable_(GLSL)
void main()
{
   vec4 textureColor = texture2D(pTexture, vUv);
   gl_FragColor = vec4(textureColor.rgb, 1.0);
}