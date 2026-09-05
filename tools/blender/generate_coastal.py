"""Original Port Solace asset kit. Blender 4.5+/5.x, no external assets.
Run: blender --background --python tools/blender/generate_coastal.py -- --output examples/coastal-city/public/assets
Assets are built in metres, Blender Z-up, front -Y (vehicles +Y); glTF export is Y-up.
"""
import argparse, bpy, math, json, pathlib, random, sys
import numpy as np
from mathutils import Vector
P = argparse.ArgumentParser(); P.add_argument('--output', default='examples/coastal-city/public/assets'); P.add_argument('--render', action='store_true'); P.add_argument('--only', default='')
a = P.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=pathlib.Path(a.output).resolve(); OUT.mkdir(parents=True,exist_ok=True)
ROOT=pathlib.Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
random.seed(7319)
M={}; CURRENT=[]; ASSETS=[]; MAN=[]

def texture(name, kind, size=512):
    rng=np.random.default_rng(7319+sum(map(ord,name))); yy,xx=np.mgrid[0:size,0:size]
    # Layered periodic detail: all authored here, no downloaded material imagery.
    n=rng.random((size,size)); broad=(np.sin(xx/19)+np.cos(yy/29)+np.sin((xx+yy)/41))/3
    if kind=='asphalt':
        v=.58+.34*n+.035*broad; v=np.where(n>.974,v+.16,v)
    elif kind=='concrete':
        v=.83+.13*n+.035*broad
        v-=.09*(np.sin(xx*.41+np.sin(yy*.04)*5)>.998)
    elif kind=='wood': v=.67+.23*n+.11*np.sin(yy*.21+np.sin(xx*.013)*4)
    elif kind=='cloth': v=.84+.06*n+.09*((xx%3==0)|(yy%3==0))
    elif kind=='bark': v=.65+.19*n+.12*np.sin(yy*.23+np.sin(xx*.038)*2)
    else: v=.88+.10*n+.025*broad
    rgb=np.stack([v,v,v,np.ones_like(v)],axis=-1).astype(np.float32)
    im=bpy.data.images.new(name,width=size,height=size,alpha=True); im.pixels.foreach_set(rgb.ravel()); im.filepath_raw=str(OUT/(name+'.png')); im.file_format='PNG'; im.save(); im.pack()
    # Sobel-like height gradients encoded as an authored tangent-space normal image.
    gy,gx=np.gradient(v); norm=np.stack([-gx*.6,-gy*.6,np.ones_like(v)],axis=-1); norm/=np.linalg.norm(norm,axis=-1,keepdims=True)
    rgba=np.concatenate([norm*.5+.5,np.ones((*v.shape,1))],axis=-1).astype(np.float32)
    normal=bpy.data.images.new(name+'_normal',width=size,height=size,alpha=True); normal.colorspace_settings.name='Non-Color'; normal.pixels.foreach_set(rgba.ravel()); normal.filepath_raw=str(OUT/(name+'_normal.png')); normal.file_format='PNG'; normal.save(); normal.pack()
    return im,normal
T={k:texture('solace_'+k,k) for k in ['asphalt','concrete','stucco','wood','cloth','bark']}
def mat(name,color,rough=.7,metal=0,detail=None,emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*color,1); p.inputs['Roughness'].default_value=rough; p.inputs['Metallic'].default_value=metal
    if detail:
        # Preserve the material colour in pixels: glTF's baseColorTexture multiplies factor.
        src,norm=T[detail]; im=src.copy(); pix=np.array(src.pixels[:]).reshape((-1,4)); pix[:,:3]*=np.array(color); im.pixels.foreach_set(pix.astype(np.float32).ravel()); im.name=name+'_albedo'; im.filepath_raw=str(OUT/(name+'_albedo.png')); im.file_format='PNG'; im.save(); im.pack()
        n=m.node_tree.nodes.new('ShaderNodeTexImage'); n.image=im; m.node_tree.links.new(n.outputs['Color'],p.inputs['Base Color'])
        nn=m.node_tree.nodes.new('ShaderNodeTexImage'); nn.image=norm; nm=m.node_tree.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value=.45; m.node_tree.links.new(nn.outputs['Color'],nm.inputs['Color']); m.node_tree.links.new(nm.outputs['Normal'],p.inputs['Normal'])
    if emission: p.inputs['Emission Color'].default_value=(*color,1); p.inputs['Emission Strength'].default_value=emission
    M[name]=m; return m
mat('limestone',(.68,.61,.46),.81,detail='concrete'); mat('ivory_stucco',(.84,.80,.67),.9,detail='stucco'); mat('coral_stucco',(.54,.26,.19),.86,detail='stucco'); mat('teal_enamel',(.05,.25,.23),.3,.35)
mat('warm_white',(.82,.82,.72),.53); mat('bronze',(.32,.22,.10),.3,.8); mat('dark_metal',(.026,.035,.037),.4,.65); mat('window_glass',(.035,.11,.14),.13,.65)
mat('warm_glass',(.39,.27,.115),.26,.25); mat('asphalt',(.16,.18,.19),.96,detail='asphalt'); mat('sidewalk',(.59,.56,.48),.92,detail='concrete'); mat('paint_white',(.85,.84,.70),.83); mat('paint_yellow',(.9,.58,.11),.74)
mat('bark',(.28,.23,.13),.93,detail='bark'); mat('frond',(.11,.23,.057),.85); mat('frond_light',(.21,.30,.075),.9); mat('wood',(.26,.13,.052),.7,detail='wood')
mat('car_paint',(.045,.17,.19),.23,.7); mat('car_glass',(.025,.075,.09),.08,.58); mat('rubber',(.011,.014,.016),.91); mat('chrome',(.66,.70,.72),.17,.96); mat('leather',(.035,.029,.025),.76,detail='cloth'); mat('headlight',(.89,.84,.61),.18,.1,emission=1.4); mat('taillight',(.58,.015,.007),.25,.2,emission=.6); mat('numberplate',(.79,.79,.67),.72)

def track(o,name,material):
    o.name=name
    if material:o.data.materials.append(M[material])
    CURRENT.append(o); return o

def cube(name,loc,dim,material,bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=track(bpy.context.object,name,material); o.dimensions=dim; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Manufactured edge radii','BEVEL'); b.width=bevel; b.segments=3
        bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=b.name)
        for f in o.data.polygons: f.use_smooth=False
    return o

def mesh(name,verts,faces,material,smooth=False):
    me=bpy.data.meshes.new(name); me.from_pydata(verts,[],faces); me.update(); o=bpy.data.objects.new(name,me); bpy.context.collection.objects.link(o); track(o,name,material)
    for f in me.polygons:f.use_smooth=smooth
    return o

def uv(o,scale=1):
    me=o.data
    layer=me.uv_layers.active or me.uv_layers.new(name='UVMap')
    for face in me.polygons:
        axis=max(range(3),key=lambda i:abs(face.normal[i])); axes=[i for i in range(3) if i!=axis]
        for li in face.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co; layer.data[li].uv=(co[axes[0]]*scale,co[axes[1]]*scale)

def tube(name,points,radius,material,res=8):
    vs=[]; fs=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(i-1,0)]); tangent.normalize(); n=tangent.cross(Vector((0,0,1)))
        if n.length<.01:n=tangent.cross(Vector((0,1,0)))
        n.normalize(); b=tangent.cross(n).normalized()
        for j in range(res):vs.append(Vector(p)+radius*(n*math.cos(j*math.tau/res)+b*math.sin(j*math.tau/res)))
    for i in range(len(points)-1):
        for j in range(res):fs.append((i*res+j,i*res+(j+1)%res,(i+1)*res+(j+1)%res,(i+1)*res+j))
    fs.extend([tuple(reversed(range(res))),tuple((len(points)-1)*res+j for j in range(res))]); return mesh(name,vs,fs,material,True)

def cylinder(name,loc,radius,depth,material,vertices=20,rot=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=depth,location=loc); o=track(bpy.context.object,name,material)
    if rot:o.rotation_euler=rot
    for p in o.data.polygons:p.use_smooth=len(p.vertices)==4
    return o

def text(name,value,loc,size,material,rot=(math.pi/2,0,0)):
    cu=bpy.data.curves.new(name,'FONT'); cu.body=value; cu.align_x='CENTER'; cu.size=size; cu.extrude=.007; cu.bevel_depth=.001; o=bpy.data.objects.new(name,cu); bpy.context.collection.objects.link(o); o.location=loc; o.rotation_euler=rot; cu.materials.append(M[material]); bpy.context.view_layer.objects.active=o; o.select_set(True); bpy.ops.object.convert(target='MESH'); o=bpy.context.object; CURRENT.append(o); o.select_set(False); return o

def join(objects,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]; bpy.ops.object.join(); o=bpy.context.object; o.name=name; bpy.ops.object.transform_apply(location=False,rotation=False,scale=True); tri=o.modifiers.new('Export triangulation','TRIANGULATE'); bpy.ops.object.modifier_apply(modifier=tri.name); uv(o); return o

def finish(id,colliders,description,separate=None):
    global CURRENT
    groups=separate or {'body':CURRENT[:]}; nodes=[]
    for k,objs in groups.items():
        if not objs:continue
        o=join(objs,k if k.startswith('wheel_') else id+'_'+k); nodes.append(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in nodes:o.select_set(True)
    bpy.context.view_layer.objects.active=nodes[0]
    coords=[o.matrix_world@Vector(c) for o in nodes for c in o.bound_box]; mins=[min(v[i] for v in coords) for i in range(3)]; maxs=[max(v[i] for v in coords) for i in range(3)]
    triangles=sum(len(p.vertices)-2 for o in nodes for p in o.data.polygons)
    kw=dict(export_format='GLB',use_selection=True,export_apply=True,export_yup=True,export_texcoords=True,export_normals=True,export_tangents=True,export_materials='EXPORT',export_animations=False,export_extras=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(id+'.glb')),**kw)
    lod=[]
    for o in nodes:
        d=o.copy(); d.data=o.data.copy(); bpy.context.collection.objects.link(d); lod.append(d); dec=d.modifiers.new('Distance LOD','DECIMATE'); dec.ratio=.38; dec.use_collapse_triangulate=True
    bpy.ops.object.select_all(action='DESELECT')
    for o in lod:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(id+'_lod1.glb')),**kw)
    for o in lod:bpy.data.objects.remove(o,do_unlink=True)
    entry={'id':id,'file':id+'.glb','lodFile':id+'_lod1.glb','triangles':triangles,'bounds':{'min':[mins[0],mins[2],-maxs[1]],'max':[maxs[0],maxs[2],-mins[1]]},'colliders':colliders,'description':description}
    MAN.append(entry); ASSETS.append((id,nodes)); CURRENT=[]
    for o in nodes:o.hide_set(True); o.hide_render=True

def collider(c,h):return {'center':c,'halfExtents':h}

def windows(width,depth,levels,bay=2.8,start=4):
    for z in [start+i*3.1 for i in range(levels)]:
        for x in np.arange(-width/2+1.5,width/2-.5,bay):
            cube('recessed_window_reveal',(x,-depth/2-.06,z),(1.68,.15,2.1),'limestone',.045)
            cube('reflective_glazing',(x,-depth/2-.15,z+.03),(1.43,.035,1.87),'window_glass',.035)
            for dx in [-.73,0,.73]:cube('bronze_window_mullion',(x+dx,-depth/2-.20,z+.03),(.047,.08,1.9),'bronze',.008)
            cube('projecting_sill',(x,-depth/2-.23,z-.97),(1.92,.41,.12),'warm_white',.035)
        for side in [-1,1]:
            for y in np.arange(-depth/2+2,depth/2-.5,3.2):
                cube('side_window_reveal',(side*(width/2+.025),y,z),(.12,1.76,2.05),'limestone',.025)
                cube('side_glazing',(side*(width/2+.1),y,z),(.025,1.55,1.82),'window_glass',.015)
                cube('side_mullion',(side*(width/2+.13),y,z),(.035,.055,1.85),'bronze',.006)

def hotel():
    w,d=23,13
    cube('foundation',(0,0,.16),(w+.8,d+.7,.32),'limestone',.1)
    cube('arcade_back_wall',(0,.8,1.8),(w,11,3.25),'coral_stucco',.18)
    cube('main_tower',(0,0,9.4),(w,d,12.2),'ivory_stucco',.43)
    for z in [3.2,6.4,9.5,12.6,15.7]:cube('wraparound_cornice',(0,0,z),(w+.56,d+.5,.20),'warm_white',.075)
    for x in np.arange(-10.3,9.0,3):
        cube('arcade_column',(x,-6.08,1.6),(.5,.7,3.2),'limestone',.09)
        cube('shop_frame',(x+1.4,-5.35,1.63),(2.35,.16,2.65),'bronze',.04)
        cube('shop_glass',(x+1.4,-5.45,1.68),(2.12,.04,2.38),'window_glass',.035)
        for k in range(3):cube('shop_horizontal_detail',(x+1.4,-5.48,.61+k*.53),(2.07,.03,.025),'warm_white')
    windows(w,d,4)
    cube('entrance_canopy',(0,-7.2,3.1),(8,3.2,.25),'teal_enamel',.13)
    for x in [-3.7,3.7]:cylinder('canopy_column',(x,-8.25,1.48),.055,2.96,'bronze')
    cube('entry_transom',(0,-5.47,2.4),(3.3,.2,.16),'bronze',.04)
    text('hotel_lettering','THE BREAKWATER',(0,-8.84,3.45),.46,'warm_white')
    for x in [-9.25,-8.88,8.88,9.25]:cube('deco_vertical_fins',(x,-6.73,9.55),(.16,.52,12.7),'teal_enamel',.045)
    cube('roof_terrace',(0,.6,16),(19,10,.28),'limestone',.1)
    cube('roof_step_one',(0,1.1,16.65),(12,7,1.15),'ivory_stucco',.3)
    cube('roof_step_two',(0,1.1,17.4),(7,5,.42),'warm_white',.18)
    for x in [-7.3,7.3]:
        cube('roof_air_handler',(x,2.8,16.6),(2,2,1),'dark_metal',.11)
        for i in range(8):cube('hvac_louvre',(x-0.86+i*.245,1.775,16.65),(.06,.055,.68),'warm_white',.015)
    for x in [-8,8]:cube('planter',(x,-7.3,.38),(2.15,.8,.74),'limestone',.12)
    finish('hotel',[collider([0,8,0],[11.7,8,6.6])],'Original 23m coastal hotel with recessed glazing, bronze mullions, shaded arcade, stepped parapets and rooftop service detail.')

def storefront():
    cube('shop_foundation',(0,0,.1),(12.8,9,.2),'limestone',.07)
    cube('shop_volume',(0,.15,3.65),(12.2,8.1,7.1),'coral_stucco',.24)
    for x in [-4,0,4]:
        cube('shopfront_reveal',(x,-4,1.65),(3.5,.15,2.9),'limestone',.05)
        cube('shopfront_glass',(x,-4.11,1.63),(3.2,.08,2.56),'window_glass',.035)
        for dx in [-1.61,0,1.61]:cube('frame',(x+dx,-4.18,1.65),(.065,.09,2.66),'bronze',.016)
        aw=cube('canvas_awning',(x,-4.72,3.15),(3.78,1.65,.12),'teal_enamel',.05); aw.rotation_euler[0]=.21
        cube('awning_valance',(x,-5.51,2.99),(3.78,.07,.23),'teal_enamel',.015)
        for i in range(10):cube('awning_stripe',(x-1.72+i*.38,-5.557,2.98),(.12,.012,.2),'warm_white')
    cube('horizontal_sign_band',(0,-4.17,3.92),(12.3,.15,.75),'warm_white',.08)
    text('market_lettering','SOLACE  /  PROVISIONS',(0,-4.28,3.74),.45,'teal_enamel')
    windows(12.2,8.1,1,start=5.52,bay=2.5)
    for z in [4.45,7.3]:cube('shop_coping',(0,.05,z),(12.65,8.6,.22),'limestone',.07)
    for x in [-5.93,5.93]:cube('pilaster',(x,-4.16,3.7),(.29,.29,7.2),'ivory_stucco',.06)
    cube('roof_vent',(2,1,7.62),(1.9,1.7,.55),'dark_metal',.08)
    text('street_number','018',(5.4,-4.35,1.6),.2,'warm_white')
    finish('storefront',[collider([0,3.7,0],[6.2,3.7,4.1])],'Two-storey corner provisions shop, shaded awnings, recessed shopfronts and lettering.')

def warehouse():
    cube('warehouse',(0,0,3),(21,16,6),'ivory_stucco',.11)
    cube('warehouse_plinth',(0,0,.6),(21.3,16.2,1.2),'limestone',.05)
    for x in [-7,0,7]:
        cube('loading_door_recess',(x,-8.07,2.4),(5.7,.18,4.7),'dark_metal',.04)
        for z in np.arange(.27,4.6,.19):cube('roller_shutter_slat',(x,-8.19,z),(5.2,.12,.14),'teal_enamel',.024)
        for dx in [-2.8,2.8]:cube('loading_jamb',(x+dx,-8.3,2.35),(.19,.38,4.7),'limestone',.04)
        cube('loading_canopy',(x,-9.1,5.07),(6.6,2.35,.17),'dark_metal',.05)
    for x in np.arange(-10,10.1,1):cube('wall_panel_seam',(x,-8.04,5.67),(.035,.035,.5),'limestone')
    for y in [-5,0,5]:
        vs=[(-10.5,y-2.5,6),(10.5,y-2.5,6),(-10.5,y+2.1,7.6),(10.5,y+2.1,7.6),(-10.5,y+2.5,6),(10.5,y+2.5,6)]
        mesh('sawtooth_roof',vs,[(0,1,3,2),(2,3,5,4),(0,2,4),(1,5,3)],'dark_metal')
        cube('clerestory',(0,y+2.3,6.85),(20.5,.055,1.2),'window_glass',.03)
    text('harbor_sign','BREAKWATER  MARINE  WORKS',(0,-8.30,5.48),.53,'dark_metal')
    finish('warehouse',[collider([0,3.8,0],[10.6,3.8,8.2])],'Sawtooth-roof marine workshop with corrugated shutters, clerestories and loading canopies.')

def palm():
    pts=[(.012*t*t,-.014*t*t,t) for t in np.linspace(0,7.4,31)]
    vs=[]; fs=[]; segments=14
    for i,p in enumerate(pts):
        r=.21*(1-i/len(pts)*.44)*(1+.035*math.sin(i*2.5))
        for j in range(segments):vs.append((p[0]+r*math.cos(j*math.tau/segments),p[1]+r*math.sin(j*math.tau/segments),p[2]))
    for i in range(len(pts)-1):
        for j in range(segments):fs.append((i*segments+j,i*segments+(j+1)%segments,(i+1)*segments+(j+1)%segments,(i+1)*segments+j))
    mesh('curved_ringed_trunk',vs,fs,'bark',True)
    crown=Vector(pts[-1]); crown.z-=.05
    for f in range(17):
        angle=f*2.39996; length=3.5+random.random()*1.3; slope=.5+random.random()*.45
        direction=Vector((math.cos(angle),math.sin(angle),0)); side=Vector((-math.sin(angle),math.cos(angle),0))
        stem=[crown+direction*(t*length)+Vector((0,0,math.sin(t*math.pi)*slope-t*t*1.35)) for t in np.linspace(0,1,18)]
        tube('palm_rachis',stem,.018,'frond',5)
        for li,t in enumerate(np.linspace(.10,.96,20)):
            center=crown+direction*(t*length)+Vector((0,0,math.sin(t*math.pi)*slope-t*t*1.35)); ll=.82*(math.sin(t*math.pi)**.65)+.10
            for sign in [-1,1]:
                end=center+side*ll*sign-direction*.32+Vector((0,0,-.18-.15*t)); mid=center.lerp(end,.51)+Vector((0,0,.065)); w=.086*(1-t*.5)
                mesh('palm_leaflet',[center-direction*.025,mid-direction*w,end,mid+direction*w,mid+Vector((0,0,.025))],[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],'frond_light' if li%5==0 else 'frond',True)
    finish('palm',[collider([.22,3.3,.32],[.42,3.3,.49])],'Wind-curved palm with modeled rachises and over six hundred folded leaflets; no billboard foliage.')

def streetlight():
    cube('lamp_base',(0,0,.12),(.44,.44,.24),'dark_metal',.06)
    cylinder('lamp_standard',(0,0,3.45),.075,6.65,'dark_metal')
    tube('curved_mast',[(0,0,6.5),(0,0,6.9),(0,-.10,7.18),(0,-.4,7.37),(0,-1,7.42),(0,-1.65,7.42)],.065,'dark_metal',10)
    cube('luminaire_housing',(0,-1.6,7.36),(.36,.8,.16),'dark_metal',.085)
    cube('luminaire_lens',(0,-1.6,7.265),(.28,.62,.035),'headlight',.02)
    cube('inspection_hatch',(0,-.082,.64),(.075,.02,.26),'bronze',.02)
    finish('streetlight',[collider([0,3.5,0],[.11,3.5,.11])],'7.4m municipal curved mast luminaire, inset lens, cast base and maintenance hatch.')

def bench():
    for y in [-.26,-.12,.02,.16,.3]:cube('timber_seat_slat',(0,y,.46),(1.86,.10,.065),'wood',.025)
    for z in [.67,.82,.97]:cube('backrest_slat',(0,.35,z),(1.86,.07,.1),'wood',.025)
    for x in [-.7,.7]:
        for y in [-.18,.26]:cube('bench_leg',(x,y,.23),(.05,.05,.46),'dark_metal',.015)
        tube('bench_back_support',[(x,-.26,.39),(x,.32,.39),(x,.39,1.02)],.03,'dark_metal')
        tube('bench_armrest',[(x,-.25,.45),(x,-.25,.65),(x,.28,.65),(x,.34,.86)],.025,'dark_metal')
    finish('bench',[collider([0,.5,0],[.95,.5,.42])],'Timber and cast-metal public bench with slatted seat, backrest and rounded arm supports.')

def bollard():
    cylinder('bollard_base',(0,0,.035),.18,.07,'dark_metal')
    cylinder('bollard_shaft',(0,0,.46),.085,.85,'dark_metal')
    cylinder('reflector_band',(0,0,.72),.089,.085,'paint_white')
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.086,location=(0,0,.887)); o=track(bpy.context.object,'bollard_cap','dark_metal')
    finish('bollard',[collider([0,.48,0],[.09,.48,.09])],'Round capped steel traffic bollard with reflective band.')

def road():
    cube('asphalt_slab',(0,0,-.1),(14,32,.2),'asphalt',.025)
    for x in [-.11,.11]:cube('double_center_line',(x,0,.006),(.105,32,.01),'paint_yellow')
    for x in [-3.65,3.65]:
        for y in [-13,-5,3,11]:cube('lane_dash',(x,y,.009),(.10,3.0,.012),'paint_white')
    for x in [-6.82,6.82]:cube('road_edge_line',(x,0,.008),(.09,32,.01),'paint_white')
    finish('road',[collider([0,-.1,0],[7,.1,16])],'14m by 32m four-lane arterial pavement with correct 3.5m lanes and double center line.')

def sidewalk():
    for i in range(16):cube('cast_concrete_flag',(0,-15+i*2,.055),(2.98,1.985,.11),'sidewalk',.024)
    for i in range(32):cube('curb_stone',(-1.51,-15.5+i,.055),(.22,.985,.24),'limestone',.035)
    for y in [-12,12]:
        cube('storm_drain_recess',(-1.38,y,.123),(.40,.75,.013),'dark_metal',.025)
        for i in range(8):cube('drain_grille',(-1.38,y-.32+i*.09,.138),(.35,.025,.018),'bronze',.005)
    finish('sidewalk',[collider([0,.05,0],[1.63,.11,16])],'3m by 32m sidewalk flags, radiused precast curb and inset storm drain grilles.')

def sedan():
    # Sculpted cross sections, deliberately independent from any real vehicle model.
    ys=[-2.34,-2.27,-2.05,-1.65,-1.25,-.8,0,.65,1.25,1.75,2.10,2.27,2.34]
    widths=[.68,.81,.89,.94,.94,.93,.93,.94,.92,.89,.85,.79,.65]
    tops=[.63,.76,.87,.93,.96,.96,.95,.95,.89,.80,.75,.67,.57]
    profile=[(-.80,.31),(-.98,.39),(-1,.60),(-.98,.85),(-.88,1),(-.5,1.045),(0,1.055),(.5,1.045),(.88,1),(.98,.85),(1,.60),(.98,.39),(.80,.31)]
    vs=[]; fs=[]
    for y,w,top in zip(ys,widths,tops):
        for px,pz in profile:vs.append((px*w,y,.23+(top-.23)*pz))
    n=len(profile)
    for i in range(len(ys)-1):
        for j in range(n-1):fs.append((i*n+j,i*n+j+1,(i+1)*n+j+1,(i+1)*n+j))
        fs.append((i*n+n-1,i*n,(i+1)*n,(i+1)*n+n-1))
    fs.extend([tuple(reversed(range(n))),tuple((len(ys)-1)*n+j for j in range(n))])
    body=mesh('sculpted_body_shell',vs,fs,'car_paint',True)
    # Actual wheel wells remove body metal; dark wells behind arches prevent see-through.
    for y in [-1.39,1.39]:
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=.423,depth=3,location=(0,y,.36),rotation=(0,math.pi/2,0)); cutter=bpy.context.object
        bpy.context.view_layer.objects.active=body; mod=body.modifiers.new('Wheel arch cut','BOOLEAN'); mod.operation='DIFFERENCE'; mod.object=cutter; bpy.ops.object.modifier_apply(modifier=mod.name); bpy.data.objects.remove(cutter,do_unlink=True)
    bevel=body.modifiers.new('Body edge finish','BEVEL'); bevel.width=.025; bevel.segments=3; bpy.context.view_layer.objects.active=body; bpy.ops.object.modifier_apply(modifier=bevel.name)
    for y in [-1.39,1.39]:
        for side in [-1,1]:
            arc=[(side*.942,y+.43*math.cos(t),.36+.43*math.sin(t)) for t in np.linspace(0,math.pi,31)];tube('wheel_arch_edge',arc,.018,'car_paint')
    # Curved roof panel and four separate side windows.
    cabin=[(-1.38,.92,.79),(-.91,1.39,.68),(-.55,1.45,.67),(.3,1.43,.66),(1.05,.96,.82)]
    rv=[]
    for y,z,w in cabin:
        for t in np.linspace(-1,1,9):rv.append((w*t,y,z+.045*(1-t*t)))
    mesh('roof_and_windscreen',rv,[(i*9+j,i*9+j+1,(i+1)*9+j+1,(i+1)*9+j) for i in range(4) for j in range(8)],'car_glass',True)
    mesh('painted_roof',[(t*.678,y,z+.026*(1-t*t)) for y,z in [(-.88,1.407),(-.6,1.446),(-.2,1.442),(.29,1.428)] for t in np.linspace(-1,1,9)],[(i*9+j,i*9+j+1,(i+1)*9+j+1,(i+1)*9+j) for i in range(3) for j in range(8)],'car_paint',True)
    for side in [-1,1]:
        for pts in [[(-1.29,.98,.8),(-.86,1.37,.69),(-.16,1.39,.68),(-.16,.97,.865)],[(-.09,.97,.865),(-.09,1.39,.68),(.29,1.38,.675),(.98,.98,.805)]]:
            verts=[(side*w,y,z) for y,z,w in pts]; mesh('side_window',verts,[tuple(range(4))],'car_glass')
            tube('window_chrome_surround',verts+[verts[0]],.014,'chrome',8)
        tube('door_b_pillar',[(side*.865,-.125,.97),(side*.682,-.125,1.41)],.037,'dark_metal')
        tube('front_a_pillar',[(side*.827,1.055,.965),(side*.673,.29,1.435)],.035,'car_paint')
        tube('rear_c_pillar',[(side*.80,-1.38,.94),(side*.68,-.89,1.40)],.045,'car_paint')
        for y0,y1 in [(-1.12,-.12),(-.08,1.03)]:
            tube('door_panel_gap',[(side*.929,y0,.92),(side*.939,y0,.43),(side*.942,y1,.43),(side*.924,y1,.92)],.0055,'rubber',5)
            cube('recessed_door_handle',(side*.944,y0+.16,.86),(.034,.16,.033),'chrome',.014)
        tube('rocker_chrome',[(side*.912,-.92,.33),(side*.932,.92,.33)],.019,'chrome')
        mirror=cube('aero_mirror',(side*1.019,.81,1.02),(.24,.29,.115),'car_paint',.055)
        cube('mirror_glass',(side*1.029,.679,1.029),(.19,.013,.072),'chrome',.025)
        for y in [2.18,-2.18]:
            cube('lamp_cluster',(side*.6,y,.656),(.42,.11,.11),'headlight' if y>0 else 'taillight',.045)
            if y>0:
                for xoff in [-.09,.09]:cylinder('projector_lens',(side*.6+xoff,2.245,.66),.032,.012,'chrome',20,(math.pi/2,0,0))
    for y in [2.285,-2.285]:
        cube('bumper_rub_strip',(0,y,.46),(1.44,.04,.047),'dark_metal',.02)
        cube('plate',(0,y+(.024 if y>0 else -.024),.60),(.39,.025,.112),'numberplate',.017)
    cube('front_grille',(0,2.305,.715),(.62,.025,.13),'dark_metal',.035)
    for i in range(9):cube('grille_fins',(-.26+i*.065,2.325,.715),(.021,.018,.1),'chrome',.006)
    tube('hood_shutline',[(-.73,1.04,.917),(-.70,1.74,.804),(-.55,2.10,.785),(.55,2.10,.785),(.70,1.74,.804),(.73,1.04,.917)],.005,'rubber',5)
    # The glass is reflective opaque until runtime transparent sorting is complete; interior exists for future integration.
    cube('interior_floor',(0,-.15,.42),(1.56,2.47,.12),'leather',.06)
    cube('dashboard',(0,.71,.94),(1.52,.37,.20),'leather',.08)
    for y in [.10,-.70]:
        for x in [-.4,.4]:
            cube('seat_cushion',(x,y,.62),(.55,.54,.14),'leather',.09)
            seat=cube('seat_back',(x,y-.23,.91),(.54,.16,.64),'leather',.1);seat.rotation_euler[0]=-.10
            cube('headrest',(x,y-.25,1.22),(.28,.13,.16),'leather',.06)
    tube('steering_wheel',[( -.4+.17*math.cos(t),.68,1.0+.17*math.sin(t)) for t in np.linspace(0,math.tau,33)],.021,'rubber',8)
    groups={'body':CURRENT[:]}
    for y,name in [(1.39,'front'),(-1.39,'rear')]:
        for side,s in [(-1,'left'),(1,'right')]:
            start=len(CURRENT); x=side*.91
            bpy.ops.mesh.primitive_torus_add(major_radius=.257,minor_radius=.092,major_segments=40,minor_segments=12,location=(x,y,.36),rotation=(0,math.pi/2,0)); o=track(bpy.context.object,'tire','rubber');
            for p in o.data.polygons:p.use_smooth=True
            cylinder('rim_barrel',(x,y,.36),.23,.17,'dark_metal',40,(0,math.pi/2,0))
            for si in range(10):
                t=si*math.tau/10; p0=(x+side*.096,y+.061*math.cos(t),.36+.061*math.sin(t)); p1=(x+side*.104,y+.215*math.cos(t+.11),.36+.215*math.sin(t+.11));tube('alloy_spoke',[p0,p1],.016,'chrome',6)
            cylinder('hub',(x+side*.1,y,.36),.064,.027,'chrome',20,(0,math.pi/2,0))
            # Model circumferential tread grooves as fine dark ridges.
            for offset in [-.054,0,.054]:
                bpy.ops.mesh.primitive_torus_add(major_radius=.344,minor_radius=.003,major_segments=48,minor_segments=4,location=(x+offset,y,.36),rotation=(0,math.pi/2,0)); track(bpy.context.object,'tread_rib','rubber')
            objs=CURRENT[start:]; combined=join(objs,'wheel_'+name+'_'+s); bpy.context.scene.cursor.location=(x,y,.36); bpy.ops.object.origin_set(type='ORIGIN_CURSOR'); groups['wheel_'+name+'_'+s]=[combined]
    finish('sedan',[collider([0,.74,0],[.94,.58,2.28])],'Original Solace Meridian sedan, 4.68m long, carved wheel arches, sculpted roof, glass regions, detailed rims, interior, lights and four axle-origin wheel nodes.',groups)

GENERATORS={'hotel':hotel,'storefront':storefront,'warehouse':warehouse,'sedan':sedan,'palm':palm,'streetlight':streetlight,'bench':bench,'bollard':bollard,'road':road,'sidewalk':sidewalk}
for id,fn in GENERATORS.items():
    if not a.only or id in a.only.split(','):print('BUILDING',id,flush=True);fn()
(OUT/'manifest.json').write_text(json.dumps({'version':1,'units':'meters','upAxis':'Y','vehicleForward':'-Z','buildingFront':'+Z','assets':MAN},indent=2)+'\n')
# Save editable authoring source with collections arranged on a grid after export.
for i,(id,nodes) in enumerate(ASSETS):
    coll=bpy.data.collections.new(id);bpy.context.scene.collection.children.link(coll)
    for o in nodes:
        for c in list(o.users_collection):c.objects.unlink(o)
        coll.objects.link(o); o.hide_set(False); o.hide_render=False; o.location+=Vector(((i%4)*31,(i//4)*39,0))
bpy.context.scene.cursor.location=(0,0,0)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'port_solace_source.blend'))
if a.render:
    for id,nodes in ASSETS:
        for o in nodes:o.hide_render=True
    # Dedicated asset proof: vehicle, hotel and vegetation in an original physical-scale composition.
    preview=[('road',(0,0,0)),('sidewalk',(-8.5,0,0)),('sidewalk',(8.5,0,0)),('hotel',(-23,0,0)),('storefront',(19,-6,0)),('sedan',(-3,-1,0)),('palm',(-9,-9,0)),('palm',(9,5,0)),('streetlight',(9,-8,0)),('bench',(-9,-3,0))]
    for id,pos in preview:
        source=next(((i,n) for i,(name,n) in enumerate(ASSETS) if name==id),None)
        if not source:continue
        i,nodes=source
        for o in nodes:
            d=o.copy();bpy.context.collection.objects.link(d); d.hide_render=False;d.location+=Vector(pos)-Vector(((i%4)*31,(i//4)*39,0))
    bpy.ops.object.camera_add(location=(15,-25,11)); cam=bpy.context.object; direction=Vector((-3,2,4))-cam.location;cam.rotation_euler=direction.to_track_quat('-Z','Y').to_euler();cam.data.lens=36;bpy.context.scene.camera=cam
    bpy.ops.object.light_add(type='SUN',location=(0,0,20));sun=bpy.context.object;sun.rotation_euler=(.5,-.4,-.5);sun.data.energy=3;sun.data.angle=.12
    world=bpy.context.scene.world or bpy.data.worlds.new('Coastal daylight');bpy.context.scene.world=world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.61,.8,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.render.resolution_x=1600;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.filepath=str(OUT/'asset-proof.png');bpy.ops.render.render(write_still=True)
    cam.location=(1.4,5.8,2.8); cam.rotation_euler=(Vector((-3,0,.72))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=48;scene.render.filepath=str(OUT/'sedan-proof.png');bpy.ops.render.render(write_still=True)
print('ASSET_KIT_COMPLETE',json.dumps({'assets':len(MAN),'triangles':sum(x['triangles'] for x in MAN)}),flush=True)
